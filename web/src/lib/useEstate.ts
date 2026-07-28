import { useEffect, useState } from "react";
import { useReadContract, useReadContracts, useBalance } from "wagmi";
import { EstateAbi } from "../abis/Estate";
import { EstateVaultAbi } from "../abis/EstateVault";
import type { EstateInfo } from "./estate";

/// A ticking wall-clock in seconds, so countdowns update without refetching.
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export type Beneficiary = {
  id: bigint;
  wallet: `0x${string}`;
  shareBps: number;
  active: boolean;
};

export type Approver = {
  id: bigint;
  wallet: `0x${string}`;
  approved: boolean;
  active: boolean;
};

/// Loads everything the UI needs about one estate plus its vault.
export function useEstate(estate?: `0x${string}`, viewer?: `0x${string}`) {
  const enabled = Boolean(estate);

  const core = useReadContracts({
    contracts: enabled
      ? [
          { address: estate!, abi: EstateAbi, functionName: "getEstateInfo" },
          { address: estate!, abi: EstateAbi, functionName: "owner" },
          { address: estate!, abi: EstateAbi, functionName: "vault" },
          { address: estate!, abi: EstateAbi, functionName: "getActiveBeneficiaries" },
          { address: estate!, abi: EstateAbi, functionName: "getApproverIds" },
          { address: estate!, abi: EstateAbi, functionName: "settings" },
          { address: estate!, abi: EstateAbi, functionName: "approvalPolicy" },
        ]
      : [],
    query: { enabled, refetchInterval: 12_000 },
  });

  const info = core.data?.[0]?.result as EstateInfo | undefined;
  const owner = core.data?.[1]?.result as `0x${string}` | undefined;
  const vault = core.data?.[2]?.result as `0x${string}` | undefined;
  const beneficiaries = (core.data?.[3]?.result ?? []) as readonly Beneficiary[];
  const approverIds = (core.data?.[4]?.result ?? []) as readonly bigint[];
  const settings = core.data?.[5]?.result as
    | readonly [bigint, bigint, number]
    | undefined;
  const policy = core.data?.[6]?.result as
    | readonly [number, number, bigint]
    | undefined;

  // Approvers are stored by id; fetch each one. Capped at MAX_APPROVERS (5),
  // so this stays a handful of calls.
  const approverReads = useReadContracts({
    contracts: approverIds.map((id) => ({
      address: estate!,
      abi: EstateAbi,
      functionName: "getApprover" as const,
      args: [id] as const,
    })),
    query: { enabled: enabled && approverIds.length > 0, refetchInterval: 12_000 },
  });

  const approvers = (approverReads.data ?? [])
    .map((r) => r.result as Approver | undefined)
    .filter((a): a is Approver => Boolean(a));

  const vaultBalance = useBalance({
    address: vault,
    query: { enabled: Boolean(vault), refetchInterval: 12_000 },
  });

  // Kept as separate reads rather than one multicall: wagmi's multicall types
  // collapse when a conditional entry (claimable, only when a viewer is
  // connected) is spread into the array.
  const distributedRead = useReadContract({
    address: vault,
    abi: EstateVaultAbi,
    functionName: "distributed",
    query: { enabled: Boolean(vault), refetchInterval: 12_000 },
  });

  const totalClaimableRead = useReadContract({
    address: vault,
    abi: EstateVaultAbi,
    functionName: "totalClaimable",
    query: { enabled: Boolean(vault), refetchInterval: 12_000 },
  });

  const myClaimableRead = useReadContract({
    address: vault,
    abi: EstateVaultAbi,
    functionName: "claimable",
    args: viewer ? [viewer] : undefined,
    query: { enabled: Boolean(vault && viewer), refetchInterval: 12_000 },
  });

  const distributed = distributedRead.data;
  const totalClaimable = totalClaimableRead.data;
  const myClaimable = myClaimableRead.data;

  const refetch = () => {
    core.refetch();
    approverReads.refetch();
    vaultBalance.refetch();
    distributedRead.refetch();
    totalClaimableRead.refetch();
    myClaimableRead.refetch();
  };

  return {
    isLoading: core.isLoading,
    error: core.error,
    info,
    owner,
    vault,
    beneficiaries,
    approvers,
    settings,
    policy,
    vaultBalance: vaultBalance.data?.value,
    distributed,
    totalClaimable,
    myClaimable,
    refetch,
  };
}

/// Reads an estate's owner only - used to resolve a pasted address quickly.
export function useEstateOwner(estate?: `0x${string}`) {
  return useReadContract({
    address: estate,
    abi: EstateAbi,
    functionName: "owner",
    query: { enabled: Boolean(estate) },
  });
}
