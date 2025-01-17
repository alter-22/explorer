import { format as d3Format } from 'd3-format';
import { FC, useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import useAptos from '../../../aptos';
import { useLedgerInfo, useTotalSupply, useValidatorSet } from '../../../ol';
import Countdown from '../../../ui/Countdown';

const Stats: FC = () => {
  const aptos = useAptos();

  const [nextEpoch, setNextEpoch] = useState<Date>();
  const [nextEpochDate, setNextEpochDate] = useState<string>();

  const totalSupply = useTotalSupply();
  const validatorSet = useValidatorSet();
  const ledgerInfo = useLedgerInfo();

  useEffect(() => {
    let timeout: NodeJS.Timeout | undefined = undefined;
    const load = async () => {
      timeout = undefined;

      const blockResource = await aptos.getAccountResource(
        '0x1',
        '0x1::block::BlockResource',
      );
      const epochIntervalMs =
        parseInt((blockResource.data as any).epoch_interval, 10) / 1_000;

      const events = await aptos.getEventsByEventHandle(
        '0x1',
        '0x1::reconfiguration::Configuration',
        'events',
        { limit: 1 },
      );
      const lastEvent = events[0];
      const lastEpochBlock = await aptos.getBlockByVersion(
        parseInt((lastEvent as any).version, 10),
      );
      const lastEpochBlockTimestamp = Math.floor(
        parseInt(lastEpochBlock.block_timestamp, 10) / 1_000,
      );
      const nextEpoch = new Date(lastEpochBlockTimestamp + epochIntervalMs);

      setNextEpoch(nextEpoch);
      setNextEpochDate(
        new Intl.DateTimeFormat(undefined, {
          dateStyle: 'short',
          timeStyle: 'long',
        }).format(nextEpoch),
      );

      timeout = setTimeout(() => load(), epochIntervalMs);
    };
    load();

    return () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
        timeout = undefined;
      }
    };
  }, []);

  return (
    <dl className="grid grid-cols-2 gap-0.5 overflow-hidden rounded-2xl text-center md:grid-cols-5">
      <div className="flex flex-col bg-gray-400/5 p-4 h-18">
        <Link to={`/total-supply`} className="hover:underline">
          <dd className={`order-first text-2xl md:text-3xl tracking-tight text-gray-900 font-mono h-8 rounded ${!totalSupply ? "animate-pulse bg-gray-300 space-y-4" : ""}`}>
            {totalSupply ?
              `${d3Format('.3f')(Math.floor(totalSupply.amount / 1e6) / 1e3)}B` :
              null
            }
          </dd>
          <dt className="text-sm font-semibold leading-6 text-gray-600">
            Total Supply
          </dt>
        </Link>
      </div>
      <div className="flex flex-col bg-gray-400/5 p-4 h-18">
        <Link
          to={ledgerInfo ? `/blocks/${ledgerInfo.block_height}` : '/'}
          className="hover:underline"
        >
          <dd className={`order-first text-2xl md:text-3xl tracking-tight text-gray-900 font-mono h-8 rounded ${!ledgerInfo ? "animate-pulse bg-gray-300 space-y-4" : ""}`}>
            {ledgerInfo ? parseInt(ledgerInfo.block_height, 10).toLocaleString() : null}
          </dd>
          <dt className="text-sm font-semibold leading-6 text-gray-600">
            Block Height
          </dt>
        </Link>
      </div>
      <div className="flex flex-col bg-gray-400/5 p-4">
        <dt className="text-sm font-semibold leading-6 text-gray-600">Epoch</dt>
        <dd className={`order-first text-2xl md:text-3xl tracking-tight text-gray-900 font-mono h-8 rounded ${!ledgerInfo ? "animate-pulse bg-gray-300 space-y-4" : ""}`}>
          {ledgerInfo ? parseInt(ledgerInfo.epoch, 10).toLocaleString() : null}
        </dd>
      </div>
      <div className="flex flex-col bg-gray-400/5 p-4">
        <NavLink to="/validators" className="hover:underline">
          <dd className={`order-first text-2xl md:text-3xl tracking-tight text-gray-900 font-mono h-8 rounded ${!validatorSet ? "animate-pulse bg-gray-300 space-y-4" : ""}`}>
            {validatorSet ? validatorSet.active_validators.length : null}
          </dd>
          <dt className="text-sm font-semibold leading-6 text-gray-600">
            Validators
          </dt>
        </NavLink>
      </div>

      <div className="flex flex-col bg-gray-400/5 p-4">
        <dt className="text-sm font-semibold leading-6 text-gray-600">
          Next Epoch
          <div className={`text-xs text-gray-400 h-4 rounded ${!nextEpoch ? "animate-pulse bg-gray-300 space-y-4" : ""}`}>
            {nextEpoch ? nextEpochDate : null}
          </div>
        </dt>
        <dd className={`order-first text-2xl md:text-3xl tracking-tight text-gray-900 font-mono h-8 rounded ${!nextEpoch ? "animate-pulse bg-gray-300 space-y-4" : ""}`}>
          {nextEpoch ? <Countdown date={nextEpoch} /> : null}
        </dd>
      </div>
    </dl>
  );
};

export default Stats;
