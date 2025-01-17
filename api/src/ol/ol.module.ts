import process from "node:process";

import { BullModule } from "@nestjs/bullmq";
import { Module, Type } from "@nestjs/common";

import { redisClient } from "../redis/redis.service.js";
import { UserTransactionsResolver } from "./user-transactions.resolver.js";
import { ClickhouseModule } from "../clickhouse/clickhouse.module.js";
import { ModulesResolver } from "./modules.resolver.js";
import { OlService } from "./ol.service.js";
import { S3Module } from "../s3/s3.module.js";

import { OlVersionBatchProcessor } from "./ol-version-batch.processor.js";
import { OlVersionProcessor } from "./ol-version.processor.js";
import { OlDbModule } from "../ol-db/ol-db.module.js";
import { ValidatorsResolver } from "./validators.resolver.js";
import { ValidatorResolver } from "./validator.resvoler.js";
import { AccountResolver } from "./account.resolver.js";
import { TransformerService } from "./transformer.service.js";
import { OlParquetProducerProcessor } from "./ol-parquet-producer.processor.js";
import { OlClickhouseIngestorProcessor } from "./ol-clickhouse-ingestor.processor.js";
import { OlController } from "./ol.controller.js";
import { CommunityWalletsResolver } from "./community-wallets.resolver.js";
import { WalletSubscriptionModule } from "../wallet-subscription/wallet-subscription.module.js";
import { NatsModule } from "../nats/nats.module.js";
import { MovementsResolver } from "./movements.resolver.js";
import { MovementsService } from "./movements.service.js";

const roles = process.env.ROLES!.split(",");

const workersMap = new Map<string, Type<any>>([
  ["version-batch-processor", OlVersionBatchProcessor],
  ["parquet-producer-processor", OlParquetProducerProcessor],
  ["version-processor", OlVersionProcessor],
  ["clickhouse-ingestor-processor", OlClickhouseIngestorProcessor],
]);

const workers: Type<any>[] = [];

for (const role of roles) {
  const worker = workersMap.get(role);
  if (worker) {
    workers.push(worker);
  }
}

@Module({
  imports: [
    S3Module,
    NatsModule,
    ClickhouseModule,
    OlDbModule,
    WalletSubscriptionModule,

    BullModule.registerQueue({
      name: "ol-clickhouse-ingestor",
      connection: redisClient,
    }),

    BullModule.registerQueue({
      name: "ol-parquet-producer",
      connection: redisClient,
    }),

    BullModule.registerQueue({
      name: "ol-version-batch",
      connection: redisClient,
    }),

    BullModule.registerQueue({
      name: "ol-version",
      connection: redisClient,
    }),
  ],
  providers: [
    UserTransactionsResolver,
    ModulesResolver,
    MovementsResolver,

    AccountResolver,

    ValidatorResolver,
    ValidatorsResolver,
    CommunityWalletsResolver,

    OlService,
    MovementsService,
    TransformerService,

    ...workers,
  ],
  controllers: [OlController],
  exports: [OlService, TransformerService],
})
export class OlModule {}
