// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./adapters/AdapterBase.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IAdapter.sol";
import "./libraries/VaultConstants.sol";

/// @title Saffron Fixed Income Vault Factory
/// @author psykeeper, supafreq, everywherebagel, maze, rx
/// @notice Configure and deploy vault implementations; allow owner to add new vault and adapter types
contract VaultFactory is Ownable2Step {
  /// @notice Incrementing vault ID
  uint256 public nextVaultId = 1;

  /// @notice Incrementing vault type ID
  uint256 public nextVaultTypeId = 1;

  /// @notice Incrementing adapter ID
  uint256 public nextDeployedAdapterId = 1;

  /// @notice Incrementing adapter type ID
  uint256 public nextAdapterTypeId = 1;

  /// @notice Protocol fee in basis points (one basis point = 1/100 of 1%)
  uint256 public feeBps;

  /// @notice Address that collects protocol fees
  address public feeReceiver;

  /// @notice Default deposit tolerance in basis points set on adapter
  uint256 public defaultDepositTolerance = 100;

  /// @notice Uniswap V3 Position Manager address for adapters
  address public immutable positionManager;

  struct VaultInfo {
    address creatorAddress;
    address addr;
    address adapterAddress;
    uint256 vaultTypeId;
  }

  /// @notice Info about vault, mapped by vault ID
  mapping(uint256 => VaultInfo) public vaultInfo;

  /// @notice ID of vault, mapped by vault address
  mapping(address => uint256) public vaultAddrToId;

  /// @notice Vault bytecode, mapped by vault type ID
  mapping(uint256 => bytes) public vaultTypeByteCode;

  struct AdapterInfo {
    uint256 adapterTypeId;
    address creatorAddress;
    address addr;
  }

  /// @notice Adapter info, mapped by adapter ID
  mapping(uint256 => AdapterInfo) public deployedAdapterInfo;

  /// @notice Adapter ID, mapped by Adapter address
  mapping(address => uint256) public deployedAdapterAddrToId;

  /// @notice Adapter bytecode, mapped by adapter type ID
  mapping(uint256 => bytes) public adapterTypeByteCode;

  /// @notice Emitted when a new vault is deployed
  /// @param vaultId ID of vault
  /// @param vaultTypeId ID of vault type
  /// @param adapter Address of adapter
  /// @param creator Address of vault creator
  /// @param vault Address of vault
  event VaultCreated(uint256 vaultId, uint256 indexed vaultTypeId, address adapter, address indexed creator, address indexed vault);

  /// @notice Emitted when a new vault is initialized
  /// @param fixedSideCapacity Maximum capacity of fixed side
  /// @param variableSideCapacity Maximum capacity of variable side
  /// @param duration How long the vault will be locked once started, in seconds
  /// @param variableAsset Address of the variable base asset
  /// @param adapter Address of vault's corresponding adapter
  /// @param feeBps Protocol fee in basis points
  /// @param feeReceiver Snapshot of fee receiver at initialization time (vault queries current value from factory)
  /// @param creator Address of vault creator
  /// @param vault Address of vault
  event VaultInitialized(
    uint256 duration,
    address adapter,
    uint256 fixedSideCapacity,
    uint256 variableSideCapacity,
    address variableAsset,
    uint256 feeBps,
    address feeReceiver,
    address indexed creator,
    address indexed vault
  );

  /// @notice Emitted when an adapter is deployed
  /// @param id ID of adapter
  /// @param adapterTypeId Type ID of adapter
  /// @param pool Address of adapter's Uniswap V3 pool
  /// @param creator Address of creator
  /// @param adapter Address of adapter
  event AdapterCreated(uint256 id, uint256 indexed adapterTypeId, address pool, address indexed creator, address indexed adapter);

  /// @notice Emitted when a new adapter type is added
  /// @param id ID of new adapter type
  /// @param creator Address of creator
  event AdapterTypeAdded(uint256 id, address indexed creator);

  /// @notice Emitted when a new vault type is added
  /// @param id ID of new vault type
  /// @param creator Address of creator
  event VaultTypeAdded(uint256 id, address indexed creator);

  /// @notice Emitted when an adapter type is revoked
  /// @param id ID of revoked adapter type
  /// @param revoker Address of revoker
  event AdapterTypeRevoked(uint256 id, address indexed revoker);

  /// @notice Emitted when a vault type is revoked
  /// @param id ID of revoked vault type
  /// @param revoker Address of revoker
  event VaultTypeRevoked(uint256 id, address indexed revoker);

  /// @notice Emitted when the fee is updated
  /// @param feeBps New fee basis points
  /// @param setter Address of setter
  event FeeBpsSet(uint256 feeBps, address indexed setter);

  /// @notice Emitted when the fee receiver is updated
  /// @param feeReceiver New fee receiver
  /// @param setter Address of setter
  event FeeReceiverSet(address feeReceiver, address indexed setter);

  /// @notice Emitted when the default deposit tolerance is updated
  /// @param defaultDepositTolerance New default deposit tolerance
  /// @param setter Address of setter
  event DefaultDepositToleranceSet(uint256 defaultDepositTolerance, address indexed setter);

  constructor(address _positionManager) {
    require(address(_positionManager).code.length > 0, "IPM");
    feeReceiver = msg.sender;
    positionManager = _positionManager;
  }

  /// @notice Deploys a new vault
  /// @param _vaultTypeId ID of vault type to use
  /// @param _adapterAddress Address of the adapter to use
  /// @dev Adapter must be created before calling this function
  function createVault(uint256 _vaultTypeId, address _adapterAddress) virtual public {
    // Check vault type exists before loading bytecode
    require(vaultTypeByteCode[_vaultTypeId].length != 0, "BV");

    // Get bytecode for the vault we want to deploy
    bytes memory bytecode = vaultTypeByteCode[_vaultTypeId];

    // Get adapter at address specified and make sure msg.sender is the same as adapter's deployer
    uint256 adapterId = deployedAdapterAddrToId[_adapterAddress];
    require(adapterId != 0, "AND");
    AdapterInfo memory _adapterInfo = deployedAdapterInfo[adapterId];
    require(_adapterInfo.creatorAddress == msg.sender, "AWC");
    require(AdapterBase(_adapterInfo.addr).vaultAddress() == address(0), "AIU");

    // Ensure the adapter's type still has valid bytecode (not deleted/revoked)
    require(adapterTypeByteCode[_adapterInfo.adapterTypeId].length != 0, "BDE"); // Bytecode Deleted

    // Deploy vault (constructor sets factory to msg.sender)
    uint256 vaultId = nextVaultId++;
    address vaultAddress;
    assembly {
      vaultAddress := create(0, add(bytecode, 32), mload(bytecode))
    }
    require(vaultAddress != address(0), "FTC");

    // Store vault info
    VaultInfo memory _vaultInfo = VaultInfo({
      creatorAddress: msg.sender,
      addr: vaultAddress,
      adapterAddress: _adapterAddress,
      vaultTypeId: _vaultTypeId
    });
    vaultInfo[vaultId] = _vaultInfo;
    vaultAddrToId[vaultAddress] = vaultId;

    emit VaultCreated(vaultId, _vaultTypeId, _adapterAddress, msg.sender, vaultAddress);
  }

  /// @notice Initialize a vault that has already been created
  /// @param vaultId ID of vault to initialize
  /// @param fixedSideCapacity Max capacity of the fixed side of the vault
  /// @param variableSideCapacity Max capacity of the variable side of the vault
  /// @param duration How long the vault will be locked once started, in seconds
  /// @param variableAsset Address of the variable base asset
  /// @param expectedFeeBps Expected fee basis points to prevent unexpected fee changes
  function initializeVault(
    uint256 vaultId,
    uint256 fixedSideCapacity,
    uint256 variableSideCapacity,
    uint256 duration,
    address variableAsset,
    uint256 expectedFeeBps
  ) public {
    // Get vault info for the vault we want to initialize and make sure msg.sender is the creator
    _checkInitializePermissions(vaultId);
    
    // Ensure the expected fee matches the current fee to prevent unexpected fee changes
    require(feeBps == expectedFeeBps, "FEE_MISMATCH");

    // Initialize vault and assign its corresponding adapter
    IVault(vaultInfo[vaultId].addr).initialize(vaultId, duration, vaultInfo[vaultId].adapterAddress, fixedSideCapacity, variableSideCapacity, variableAsset, feeBps);
    IAdapter adapter = IAdapter(vaultInfo[vaultId].adapterAddress);
    adapter.setVault(vaultInfo[vaultId].addr);

    emit VaultInitialized(
      duration,
      vaultInfo[vaultId].adapterAddress,
      fixedSideCapacity,
      variableSideCapacity,
      variableAsset,
      feeBps,
      feeReceiver,
      msg.sender,
      vaultInfo[vaultId].addr
    );
  }

  /// @notice Check permissions for vault initialization
  /// @param vaultId ID of vault to check permissions for
  function _checkInitializePermissions(uint256 vaultId) internal virtual {
    // Default implementation: only vault creator can initialize
    require(vaultInfo[vaultId].creatorAddress == msg.sender, "CMI");
  }

  /// @notice Adds a new vault bytecode, indexed by an auto-incremented vault type ID
  /// @param bytecode Bytecode of new vault type
  /// @return New vault type ID
  /// @dev Vault should satisfy IVault interface to be a valid vault
  function addVaultType(bytes calldata bytecode) external onlyOwner returns (uint256) {
    require(bytecode.length > 0, "NEI");
    uint256 vtId = nextVaultTypeId++;
    vaultTypeByteCode[vtId] = bytecode;
    emit VaultTypeAdded(vtId, msg.sender);
    return vtId;
  }

  /// @notice Removes a vault type, preventing new vault deployments from using this type
  /// @param id ID of vault type to revoke
  function revokeVaultType(uint256 id) external onlyOwner {
    require(id < nextVaultTypeId, "IVT");
    delete vaultTypeByteCode[id];
    emit VaultTypeRevoked(id, msg.sender);
  }

  /// @notice Deploys a new Adapter
  /// @param adapterTypeId ID of adapter type to use
  /// @param poolAddress Pool address for the adapter
  /// @param data Data to pass to adapter initializer, implementation dependent
  function createAdapter(
    uint256 adapterTypeId,
    address poolAddress,
    bytes calldata data
  ) public virtual {
    // Check adapter type exists before loading bytecode
    require(adapterTypeByteCode[adapterTypeId].length != 0, "BA");

    // Get bytecode for the adapter we want to deploy
    bytes memory bytecode = adapterTypeByteCode[adapterTypeId];

    // Encode constructor arguments (PositionManager address) and append to bytecode
    bytes memory constructorArgs = abi.encode(positionManager);
    bytes memory bytecodeWithArgs = abi.encodePacked(bytecode, constructorArgs);

    // Deploy adapter with constructor arguments
    address adapterAddress;
    assembly {
      adapterAddress := create(0, add(bytecodeWithArgs, 32), mload(bytecodeWithArgs))
    }
    require(adapterAddress != address(0), "FTC");

    // Initialize adapter
    uint256 adapterId = nextDeployedAdapterId++;
    IAdapter(adapterAddress).initialize(adapterId, poolAddress, defaultDepositTolerance, data);

    // Store adapter info
    AdapterInfo memory ai = AdapterInfo({creatorAddress: msg.sender, addr: adapterAddress, adapterTypeId: adapterTypeId});
    deployedAdapterInfo[adapterId] = ai;
    deployedAdapterAddrToId[adapterAddress] = adapterId;

    emit AdapterCreated(adapterId, adapterTypeId, poolAddress, msg.sender, adapterAddress);
  }

  /// @notice Adds a new adapter bytecode, indexed by an auto-incremented adapter type ID
  /// @param bytecode Bytecode of new adapter type
  /// @return New adapter type ID
  function addAdapterType(bytes calldata bytecode) external onlyOwner returns (uint256) {
    require(bytecode.length > 0, "NEI");
    uint256 atId = nextAdapterTypeId++;
    adapterTypeByteCode[atId] = bytecode;
    emit AdapterTypeAdded(atId, msg.sender);
    return atId;
  }

  /// @notice Removes an adapter type, preventing new vault deployments from using this type
  /// @param id ID of adapter type to revoke
  function revokeAdapterType(uint256 id) external onlyOwner {
    require(id < nextAdapterTypeId, "IAT");
    delete adapterTypeByteCode[id];
    emit AdapterTypeRevoked(id, msg.sender);
  }

  /// @notice Check to see if a given vault or adapter address was deployed by this factory
  /// @return True if address matches a vault or adapter deployed by this factory
  function wasDeployedByFactory(address addr) external view returns (bool) {
    return vaultAddrToId[addr] != 0 || deployedAdapterAddrToId[addr] != 0;
  }

  /// @notice Set protocol fee basis points
  /// @param _feeBps New basis points value to set as protocol fee
  function setFeeBps(uint256 _feeBps) external onlyOwner {
    require(_feeBps < VaultConstants.MAX_BPS, "IBP");
    feeBps = _feeBps;
    emit FeeBpsSet(_feeBps, msg.sender);
  }

  /// @notice Set new address to collect protocol fees
  /// @param _feeReceiver New address to set as fee receiver
  function setFeeReceiver(address _feeReceiver) external onlyOwner {
    require(_feeReceiver != address(0x0), "IFR");
    feeReceiver = _feeReceiver;
    emit FeeReceiverSet(_feeReceiver, msg.sender);
  }

  /// @notice Set new default deposit tolerance to be configured on newly deployed adapters
  /// @param _defaultDepositTolerance New default deposit tolerance in basis points
  function setDefaultDepositTolerance(uint256 _defaultDepositTolerance) external onlyOwner {
    require(_defaultDepositTolerance != 0, "NEI");
    require(_defaultDepositTolerance <= VaultConstants.MAX_BPS, "IBP");
    defaultDepositTolerance = _defaultDepositTolerance;
    emit DefaultDepositToleranceSet(_defaultDepositTolerance, msg.sender);
  }

  /// @notice Disable ownership renunciation
  function renounceOwnership() public override {
    revert("RD"); // Renunciation Disabled
  }
}
