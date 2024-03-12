import os from "node:os";
import pathUtil from "node:path";
import fs from "node:fs";

import _ from "lodash";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { OnModuleInit } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import BN from "bn.js";
import axios from "axios";
import Bluebird from "bluebird";
import { Types } from "aptos";
import { JSONCodec } from "nats";
import { ConfigService } from "@nestjs/config";
import qs from "qs";

import { OlDbService } from "../ol-db/ol-db.service.js";
import { ClickhouseService } from "../clickhouse/clickhouse.service.js";
import { TransformerService } from "./transformer.service.js";
import { NotPendingTransaction } from "./types.js";
import { OlConfig } from "../config/config.interface.js";
import { WalletSubscriptionService } from "../wallet-subscription/wallet-subscription.service.js";
import { NatsService } from "../nats/nats.service.js";
import { bnBisect } from "../utils.js";

const ZERO = new BN(0);
const ONE = new BN(1);

// Find a BN number in a ascending sorted list
const bnFindIndex = (list: BN[], element: BN): number => {
  const index = bnBisect.center(list, element);
  if (index === -1 || index >= list.length) {
    return -1;
  }
  if (list[index].eq(element)) {
    return index;
  }
  return -1;
};

export interface VersionJobData {
  version: string;
}

@Processor("ol-version")
export class OlVersionProcessor extends WorkerHost implements OnModuleInit {
  private static jsonCodec = JSONCodec();

  private readonly providerHost: string;

  public constructor(
    @InjectQueue("ol-version")
    private readonly olVersionQueue: Queue,

    configService: ConfigService,

    private readonly transformerService: TransformerService,

    private readonly olDbService: OlDbService,

    private readonly clickhouseService: ClickhouseService,

    private readonly natsService: NatsService,

    private readonly walletSubscriptionService: WalletSubscriptionService,
  ) {
    super();

    const config = configService.get<OlConfig>("ol")!;
    this.providerHost = config.provider;
  }

  public async onModuleInit() {
    // const js = this.natsService.jetstream;

    // const kv = await js.views.kv("ol");
    // await kv.put("ledger.latestVersion", "0");

    // let entry = await kv.get("ledger.latestVersion");
    // console.log(`${entry?.key} @ ${entry?.revision} -> ${entry?.string()}`);

    // const ledgerLatestVersion = new BN(entry?.string() ?? "0");
    // console.log("ledgerLatestVersion", ledgerLatestVersion);

    // const start = ledgerLatestVersion;
    // const end = start.add(new BN(1_000));

    // const resultSet = await this.clickhouseService.client.query({
    //   query: `
    //     (
    //       SELECT "version"
    //       FROM
    //         "user_transaction"
    //       WHERE
    //         "version" BETWEEN {start:String} AND {end:String}
    //       ORDER BY "version" ASC
    //     )

    //     UNION ALL

    //     (
    //       SELECT "version"
    //       FROM
    //         "block_metadata_transaction"
    //       WHERE
    //         "version" BETWEEN {start:String} AND {end:String}
    //       ORDER BY "version" ASC
    //     )
    //   `,
    //   query_params: {
    //     start: start.toString(10),
    //     end: end.toString(10),
    //   },
    //   format: "JSONEachRow"
    // });
    // const rows = await resultSet.json();
    // console.log(rows);

    await this.olVersionQueue.add("getMissingVersions", undefined, {
      repeat: {
        every: 8 * 60 * 60 * 1_000, // 8 hours
      },
    });

    await this.olVersionQueue.add("fetchLatestVersion", undefined, {
      repeat: {
        every: 30 * 1_000, // 30 seconds
      },
    });

    // const versions = [
    //   0, 3, 357451, 383074, 750119, 1013884, 1381594, 1755416, 2129981, 2471148,
    //   2881024, 3230553, 3544066, 3904673, 4276587, 4547740, 4910530, 5266217,
    //   5601203, 5861979, 6192113, 6476658, 6791428, 7103475, 7451257, 7801233,
    //   8111591, 8450577, 8771238, 9077846, 9427323, 9828418, 10177281, 10531814,
    //   10914227, 11316377, 11710656, 12090849, 12495421, 12898524, 13251727,
    //   13620738, 14004276, 14387731, 14789599, 15174340, 15572039, 15941510,
    //   16336657, 16696634, 17063354, 17463463, 23992709, 24370482, 24778357,
    //   25173909, 25533427, 25913345, 26315881, 26694115, 27066756, 27443464,
    //   27805311, 28188869, 28573730,
    // ];

    // for (const version of versions) {
    //   await this.olVersionQueue.add(
    //     "version",
    //     { version: `${version}` } as VersionJobData,
    //     {
    //       jobId: `__version__${version}`,
    //     },
    //   );
    // }
  }

  public async process(job: Job<VersionJobData, any, string>) {
    switch (job.name) {
      case "getMissingVersions":
        try {
          await Promise.race([
            this.getMissingVersions(),
            // 1m timeout to avoid blocking the queue
            Bluebird.delay(60 * 60 * 1_000),
          ]);
        } catch (error) {
          // fail silently to avoid accumulating failed repeating jobs
        }
        break;

      case "version":
        await this.processVersion(job.data.version);
        break;

      case "fetchLatestVersion":
        try {
          await Promise.race([
            this.fetchLatestVersion(),
            // 1m timeout to avoid blocking the queue
            Bluebird.delay(1 * 60 * 1_000),
          ]);
        } catch (error) {
          // fail silently to avoid accumulating failed repeating jobs
        }
        break;

      default:
        throw new Error(`invalid job name ${job.name}`);
    }
  }

  private async processVersion(version: string) {
    const res = await axios({
      method: "GET",
      url: `${this.providerHost}/v1/transactions?${qs.stringify({
        start: version,
        limit: 1,
      })}`,
      signal: AbortSignal.timeout(5 * 60 * 1_000), // 5 minutes
    });
    const transactions: Types.Transaction[] = res.data;

    if (!transactions.length) {
      throw new Error(`transaction not found ${version}`);
    }
    await this.ingestTransactions(transactions);
  }

  private async fetchLatestVersion() {
    const ledgerVersion = BigInt(await this.getLedgerVersion());

    for (let i = 0; i < 1_000; ++i) {
      const version = ledgerVersion - BigInt(i);
      await this.olVersionQueue.add(
        "version",
        { version: version.toString(10) } as VersionJobData,
        {
          jobId: `__version__${version}`,
        },
      );
    }
  }

  private async ingestTransactions(transactions: Types.Transaction[]) {
    const notPendingTransactions = transactions.filter(
      (transactions) => transactions.type !== "pending_transaction",
    ) as NotPendingTransaction[];
    if (!notPendingTransactions.length) {
      return;
    }

    const dest = await fs.promises.mkdtemp(
      pathUtil.join(os.tmpdir(), "ol-version-"),
    );
    await fs.promises.mkdir(dest, { recursive: true });

    const transactionsFile = `${dest}/transactions.json`;
    await fs.promises.writeFile(
      `${dest}/transactions.json`,
      JSON.stringify(notPendingTransactions),
    );

    const parquetDest = await this.transformerService.transform([
      transactionsFile,
    ]);
    const files = await fs.promises.readdir(parquetDest);
    for (const file of files) {
      await this.clickhouseService.insertParquetFile(
        pathUtil.join(parquetDest, file),
      );
    }

    await fs.promises.rm(parquetDest, { recursive: true, force: true });
    await fs.promises.rm(dest, { recursive: true, force: true });

    const versions = notPendingTransactions.map(
      (transaction) => `(${transaction.version})`,
    );

    await this.clickhouseService.client.exec({
      query: `
        INSERT INTO "ingested_versions" ("version")
        VALUES ${versions.join()}
      `,
    });

    for (const transaction of notPendingTransactions) {
      await this.walletSubscriptionService.releaseVersion(transaction.version);
      await this.publishChanges(transaction.version);
    }
  }

  private async publishChanges(version: string) {
    const result = await this.clickhouseService.client.query({
      query: `
        SELECT DISTINCT hex("address") as "address"
        FROM (
          SELECT "address"
            FROM "coin_balance"
            WHERE "version" = {version:UInt64}

          UNION ALL

          SELECT "address"
            FROM "slow_wallet"
            WHERE "version" = {version:UInt64}
        )
      `,
      query_params: {
        version,
      },
      format: "JSONColumnsWithMetadata",
    });

    const rows = await result.json<{
      data: {
        address?: string[];
      };
    }>();
    if (!rows.data.address) {
      return;
    }

    for (const address of rows.data.address) {
      this.natsService.nc.publish(
        `wallet.${address}`,
        OlVersionProcessor.jsonCodec.encode({
          version,
        }),
      );
    }
  }

  private async getLedgerVersion(): Promise<string> {
    const res = await axios({
      method: "GET",
      url: `${this.providerHost}/v1`,
      signal: AbortSignal.timeout(5 * 60 * 1_000), // 5 minutes
    });

    return res.data.ledger_version;
  }

  private async getMissingVersions() {
    // this.natsService.nc.jetstream()

    const lastBatchIngestedVersion =
      await this.olDbService.getLastBatchIngestedVersion();

    const ingestedVersions = await this.olDbService.getIngestedVersions(
      lastBatchIngestedVersion ?? undefined,
    );
    const latestVersion = new BN(await this.getLedgerVersion());

    for (
      let i = lastBatchIngestedVersion
        ? lastBatchIngestedVersion.add(ONE)
        : ZERO;
      i.lt(latestVersion);
      i = i.add(new BN(ONE))
    ) {
      const version = i;
      if (bnFindIndex(ingestedVersions, version) !== -1) {
        continue;
      }
      await this.olVersionQueue.add(
        "version",
        { version: version.toString(10) } as VersionJobData,
        {
          jobId: `__version__${version}`,
        },
      );
    }
  }
}
