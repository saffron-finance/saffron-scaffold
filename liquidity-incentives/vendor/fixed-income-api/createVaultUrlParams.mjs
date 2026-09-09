// Generated from saffron-finance/fixed-income e0949447d985a3d161bb8c4cac8b01e91c29365a. See README.md.

// ../../fixed-income/packages/api-types/src/pendingVault.ts
var USD_TOKEN_ADDRESS = "0x0000000000000000000000000000000000555344";
function isUsdToken(address) {
  return address.toLowerCase() === USD_TOKEN_ADDRESS.toLowerCase();
}

// ../../fixed-income/packages/api-types/src/createVaultUrlParams.ts
var ADMIN_CREATE_VAULT_URL_PARAM_KEYS = {
  token0: "t0",
  token1: "t1",
  variableAsset: "var",
  feeTier: "fee",
  months: "mo",
  weeks: "wk",
  days: "dy",
  hours: "hr",
  fixedCapacityUsd: "cap",
  fixedCapacityToken: "capTok",
  fixedCapacityAmount: "capAmt",
  variableAmount: "amt",
  targetApr: "apr",
  useTargetApr: "useApr",
  minTick: "minT",
  maxTick: "maxT",
  adapterType: "type",
  requestId: "reqId",
  step: "step",
  adapterAddr: "adapterAddr",
  vaultId: "vaultId",
  vaultAddr: "vaultAddr"
};
var KEYS = ADMIN_CREATE_VAULT_URL_PARAM_KEYS;
function parseIntParam(value) {
  return value ? parseInt(value) : void 0;
}
function parseFloatParam(value) {
  return value ? parseFloat(value) : void 0;
}
function decodeAdminCreateVaultUrlParams(searchParams) {
  const adapterTypeParam = searchParams.get(KEYS.adapterType);
  const adapterType = adapterTypeParam === "fullRange" || adapterTypeParam === "limitedRange" ? adapterTypeParam : void 0;
  return {
    token0: searchParams.get(KEYS.token0) || void 0,
    token1: searchParams.get(KEYS.token1) || void 0,
    variableAsset: searchParams.get(KEYS.variableAsset) || void 0,
    feeTier: parseIntParam(searchParams.get(KEYS.feeTier)),
    months: parseIntParam(searchParams.get(KEYS.months)),
    weeks: parseIntParam(searchParams.get(KEYS.weeks)),
    days: parseIntParam(searchParams.get(KEYS.days)),
    hours: parseIntParam(searchParams.get(KEYS.hours)),
    fixedCapacityUsd: parseFloatParam(searchParams.get(KEYS.fixedCapacityUsd)),
    fixedCapacityToken: searchParams.get(KEYS.fixedCapacityToken) || void 0,
    fixedCapacityAmount: searchParams.get(KEYS.fixedCapacityAmount) || void 0,
    variableAmount: searchParams.get(KEYS.variableAmount) || void 0,
    targetApr: parseFloatParam(searchParams.get(KEYS.targetApr)),
    useTargetApr: searchParams.get(KEYS.useTargetApr) === "true" ? true : void 0,
    minTick: parseIntParam(searchParams.get(KEYS.minTick)),
    maxTick: parseIntParam(searchParams.get(KEYS.maxTick)),
    adapterType,
    requestId: searchParams.get(KEYS.requestId) || void 0,
    step: parseIntParam(searchParams.get(KEYS.step)),
    adapterAddr: searchParams.get(KEYS.adapterAddr) || void 0,
    vaultId: parseIntParam(searchParams.get(KEYS.vaultId)),
    vaultAddr: searchParams.get(KEYS.vaultAddr) || void 0
  };
}
function shouldWrite(field, value) {
  switch (field) {
    case "minTick":
    case "maxTick":
    case "step":
    case "vaultId":
      return value !== void 0;
    case "months":
    case "weeks":
    case "days":
    case "hours":
    case "fixedCapacityUsd":
    case "targetApr":
      return value !== void 0 && value > 0;
    case "useTargetApr":
      return value === true;
    default:
      return !!value;
  }
}
function encodeAdminCreateVaultUrlParams(params, into = new URLSearchParams()) {
  ;
  Object.keys(KEYS).forEach((field) => {
    if (!(field in params)) return;
    const value = params[field];
    if (shouldWrite(field, value)) {
      into.set(KEYS[field], String(value));
    } else {
      into.delete(KEYS[field]);
    }
  });
  return into;
}
function pendingVaultToUrlParams(vault, duration) {
  const hasPriceRange = vault.adapterType === "limitedRange" && vault.minTick != null && vault.maxTick != null;
  const hasFixedCapacity = !!(vault.fixedCapacityTokenAddress && vault.fixedCapacityAmount);
  const isUsdCapacity = hasFixedCapacity && isUsdToken(vault.fixedCapacityTokenAddress);
  const isTokenCapacity = hasFixedCapacity && !isUsdCapacity;
  const hasTargetApr = !!vault.useTargetApr && vault.targetApr != null;
  return {
    adapterType: vault.adapterType,
    token0: vault.token0Address,
    token1: vault.token1Address,
    feeTier: vault.feeTier,
    minTick: hasPriceRange ? vault.minTick : void 0,
    maxTick: hasPriceRange ? vault.maxTick : void 0,
    months: duration.months,
    weeks: duration.weeks,
    days: duration.days,
    hours: duration.hours,
    // USD amounts are stored in cents; the URL carries dollars.
    fixedCapacityUsd: isUsdCapacity ? Number(vault.fixedCapacityAmount) / 100 : void 0,
    // Token mode carries the address and the amount in wei.
    fixedCapacityToken: isTokenCapacity ? vault.fixedCapacityTokenAddress : void 0,
    fixedCapacityAmount: isTokenCapacity ? vault.fixedCapacityAmount : void 0,
    variableAsset: vault.variableAssetAddress,
    variableAmount: vault.variableAssetAmount || void 0,
    useTargetApr: hasTargetApr ? true : void 0,
    targetApr: hasTargetApr ? Number(vault.targetApr) : void 0,
    // Carried so the form can fetch the full request and link the vault back
    // to it on completion.
    requestId: vault.requestId
  };
}
function clearAdminCreateVaultUrlParams(searchParams) {
  Object.values(KEYS).forEach((key) => searchParams.delete(key));
  return searchParams;
}
export {
  ADMIN_CREATE_VAULT_URL_PARAM_KEYS,
  clearAdminCreateVaultUrlParams,
  decodeAdminCreateVaultUrlParams,
  encodeAdminCreateVaultUrlParams,
  pendingVaultToUrlParams
};
