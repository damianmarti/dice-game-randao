import { useEffect, useState } from "react";
import type { NextPage } from "next";
import { createPublicClient, http, keccak256, parseEther, toRlp } from "viem";
import { useAccount } from "wagmi";
import { useBlockNumber } from "wagmi";
import { useWalletClient } from "wagmi";
import { MetaHeader } from "~~/components/MetaHeader";
import { Address, IntegerInput } from "~~/components/scaffold-eth";
import {
  useScaffoldContract,
  useScaffoldContractRead,
  useScaffoldContractWrite,
  useScaffoldEventHistory,
  useTransactor,
} from "~~/hooks/scaffold-eth";
import scaffoldConfig from "~~/scaffold.config";
import { notification } from "~~/utils/scaffold-eth";

const Home: NextPage = () => {
  const [number, setNumber] = useState<string | bigint>("");
  const [betNumber, setBetNumber] = useState<number>();
  const [targetBlockNumber, setTargetBlockNumber] = useState<bigint>();
  const [rollDisabled, setRollDisabled] = useState<boolean>(true);
  const [showRollNotice, setShowRollNotice] = useState<boolean>(false);
  const [missedWindow, setMissedWindow] = useState<boolean>(false);
  const [rolled, setRolled] = useState<boolean>(false);
  const [betted, setBetted] = useState<boolean>(false);
  const [rolling, setRolling] = useState<boolean>(false);

  const writeTx = useTransactor();
  const { address } = useAccount();
  const { data: blockNumber } = useBlockNumber();

  const publicClient = createPublicClient({
    chain: scaffoldConfig.targetNetwork,
    transport: http(),
  });

  const { writeAsync, isLoading, isMining } = useScaffoldContractWrite({
    contractName: "DiceGame",
    functionName: "bet",
    args: [betNumber],
    value: parseEther("0.001"),
    onBlockConfirmation: txnReceipt => {
      console.log("Transaction blockHash", txnReceipt.blockHash);
      setBetted(true);
    },
  });

  const { data: betEvents } = useScaffoldEventHistory({
    contractName: "DiceGame",
    eventName: "Bet",
    fromBlock: scaffoldConfig.fromBlock,
    watch: true,
  });

  const { data: rollEvents } = useScaffoldEventHistory({
    contractName: "DiceGame",
    eventName: "Roll",
    fromBlock: scaffoldConfig.fromBlock,
    watch: true,
  });

  const { data: winnerEvents } = useScaffoldEventHistory({
    contractName: "DiceGame",
    eventName: "Winner",
    fromBlock: scaffoldConfig.fromBlock,
    watch: true,
  });

  const { data: walletClient } = useWalletClient();
  const { data: diceGameContract } = useScaffoldContract({
    contractName: "DiceGame",
    walletClient,
  });

  const { data: futureBlocks } = useScaffoldContractRead({
    contractName: "DiceGame",
    functionName: "futureBlocks",
  });

  const { data: betData } = useScaffoldContractRead({
    contractName: "DiceGame",
    functionName: "bets",
    args: [address],
  });

  useEffect(() => {
    if (betData && futureBlocks) {
      setTargetBlockNumber(betData[1] + (futureBlocks as unknown as bigint));
    }
  }, [betData, futureBlocks]);

  useEffect(() => {
    if (betData !== undefined && betData[2]) {
      setRolled(true);
    } else {
      setRolled(false);
    }
    if (betData !== undefined && betData[1] > 0) {
      setBetted(true);
    } else {
      setBetted(false);
    }
  }, [betData]);

  useEffect(() => {
    if (blockNumber && targetBlockNumber) {
      const show = blockNumber < targetBlockNumber;
      setShowRollNotice(show);
      const missed = blockNumber > targetBlockNumber + 256n && betData !== undefined && !betData[2];
      setMissedWindow(missed);
      const disabled = show || missed || (betData !== undefined && betData[2]);
      setRollDisabled(disabled);
    } else {
      setShowRollNotice(false);
      setMissedWindow(false);
      setRollDisabled(true);
    }
  }, [blockNumber, targetBlockNumber, betData]);

  const betDisabled = isLoading || isMining || (betted && !missedWindow && !rolled);

  const rollTheDice = async () => {
    console.log("Roll the dice: ", blockNumber);
    console.log("targetBlockNumber: ", targetBlockNumber);

    const blockData = await publicClient.getBlock({ blockNumber: targetBlockNumber });

    console.log("blockData: ", blockData);

    const values: `0x${string}`[] = [];
    values.push(blockData.parentHash);
    values.push(blockData.sha3Uncles);
    values.push(blockData.miner as `0x${string}`);
    values.push(blockData.stateRoot);
    values.push(blockData.transactionsRoot);
    values.push(blockData.receiptsRoot);
    values.push(blockData.logsBloom);
    values.push(`0x${blockData.difficulty.toString(16)}`);
    values.push(`0x${blockData.number.toString(16)}`);
    values.push(`0x${blockData.gasLimit.toString(16)}`);
    values.push(`0x${blockData.gasUsed.toString(16)}`);
    values.push(`0x${blockData.timestamp.toString(16)}`);
    values.push(blockData.extraData);
    values.push(blockData.mixHash);
    values.push(blockData.nonce);
    if ("baseFeePerGas" in blockData && blockData.baseFeePerGas !== null) {
      values.push(`0x${blockData.baseFeePerGas.toString(16)}`);
    }
    if ("withdrawalsRoot" in blockData && blockData.withdrawalsRoot !== undefined) {
      values.push(blockData.withdrawalsRoot);
    }

    console.log("blockData values: ", values);
    for (let i = 0; i < values.length; i++) {
      if (values[i] === "0x0") {
        values[i] = "0x";
      }
      if (values[i].length % 2 === 1) {
        values[i] = ("0x0" + values[i].substring(2)) as `0x${string}`;
      }
    }
    console.log("blockData values after: ", values);

    const rlpEncodedValues = toRlp(values);
    console.log("blockData RLP: ", rlpEncodedValues);

    const blockHash = keccak256(rlpEncodedValues);
    console.log("blockData hash: ", blockHash);

    if (blockHash !== blockData.hash) {
      notification.error("Block hash mismatch");
      return;
    }

    setRolling(true);
    setRollDisabled(true);

    if (diceGameContract !== undefined) {
      const makeWrite = () => diceGameContract.write.rollTheDice([rlpEncodedValues]);

      await writeTx(makeWrite, {
        onBlockConfirmation: txnReceipt => {
          console.log("Transaction blockHash", txnReceipt.blockHash);
          setRolled(true);
          setRollDisabled(true);
        },
      });
      setRolling(false);
    }
  };

  return (
    <>
      <MetaHeader />
      <div className="flex items-center flex-col flex-grow pt-10">
        <div className="px-5">
          <h1 className="text-center mb-8">
            <span className="block text-4xl font-bold">Bet a number from 0 to 15</span>
            <span className="block text-2xl mb-2 mt-2">Roll the dice when the button is enabled</span>
            <span className="block text-2xl font-bold mb-2 mt-2">Win Ξ0.015 if you guess the rolled number!</span>
          </h1>
          <div className="text-center text-lg">
            <>
              <IntegerInput
                value={number}
                onChange={newNumber => {
                  setNumber(newNumber);
                  setBetNumber(Number(newNumber));
                }}
                disabled={betDisabled}
                placeholder="number"
                disableMultiplyBy1e18
              />

              <button
                className="btn btn-primary mt-2"
                onClick={() => {
                  if (betNumber !== undefined && betNumber !== null && betNumber >= 0 && betNumber <= 15) {
                    writeAsync();
                  } else {
                    notification.error("Invalid number (0 to 15)");
                  }
                }}
                disabled={betDisabled}
              >
                Bet on {betNumber} (Ξ0.001)
              </button>
            </>
            {betData && betData[1] !== 0n && (
              <>
                <p className="text-xl font-bold">Your bet: {betData[0].toString()}</p>
                {rolled && !rolling && <p className="text-xl font-bold">Rolled: {betData[3].toString()}</p>}
                {rolling && <p className="text-xl font-bold">Rolling...</p>}
                {showRollNotice && targetBlockNumber && blockNumber && (
                  <p>Wait for {(targetBlockNumber - blockNumber).toString()} blocks to roll the dice</p>
                )}
                {missedWindow && <p className="text-l font-bold">You missed the window to roll the dice</p>}
                <button className="btn btn-primary" disabled={rollDisabled} onClick={rollTheDice}>
                  Roll the dice
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex-grow bg-base-300 w-full mt-16 px-8 py-12">
          <div className="flex justify-center items-start gap-12 flex-col sm:flex-row">
            <div className="flex flex-col bg-base-100 px-10 text-center items-center max-w-xs rounded-3xl">
              <p className="text-2xl font-bold">Bets</p>
              {betEvents &&
                betEvents.map((event, index) => (
                  <div key={index} className="mt-0">
                    <Address address={event.args.player} />
                    Bet: {event.args.number}
                  </div>
                ))}
            </div>
            <div className="flex flex-col bg-base-100 px-10 text-center items-center max-w-xs rounded-3xl">
              <p className="text-2xl font-bold">Rolls</p>
              {rollEvents &&
                rollEvents.map((event, index) => (
                  <div key={index} className="mt-0">
                    <Address address={event.args.player} />
                    Number: {event.args.number}
                  </div>
                ))}
            </div>
            <div className="flex flex-col bg-base-100 px-10 text-center items-center max-w-xs rounded-3xl">
              <p className="text-2xl font-bold">Winners</p>
              {winnerEvents &&
                winnerEvents.map((event, index) => (
                  <div key={index} className="mt-0">
                    <Address address={event.args.winner} />
                    Number: {event.args.number}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Home;
