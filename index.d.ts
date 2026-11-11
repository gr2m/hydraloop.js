export interface HydraloopOptions {
  apiKey: string;
  rootApiUrl?: string;
}

export interface Permission {
  id: string;
  name: string;
}

export interface Role {
  id: string;
  name: string;
  main: boolean;
  description: string;
  roles: Role[];
  permissions: Permission[];
}

export interface LoginUser {
  id: string;
  enabled: boolean;
  username: string;
  password: string;
  totpEnabled: boolean;
  roles: Role[];
}

export interface Person {
  id: string;
  givenname: string;
  surname: string;
  displayName: string;
  email: string;
  phoneNumber1: string;
  phoneNumber2: string;
  pipedrivePersonId: string;
  odooPersonId: string;
  odooUserId: string;
  organisationId: string;
  organisationName: string;
  userId: string;
  userEnabled: boolean;
  username: string;
  totpEnabled: boolean;
  roles: string[];
  allBoundId: string;
  enabled: boolean;
  termsAndConditionsAccepted: string;
  user: LoginUser;
}

export interface Organisation {
  id: string;
  name: string;
  parentId: string;
  parentName: string;
  address1: string;
  address2: string;
  address3: string;
  phoneNumber1: string;
  phoneNumber2: string;
  email: string;
  pipedriveOrganisationId: string;
  odooOrganisationId: string;
  primaryContactPerson: string;
  longitude: number;
  latitude: number;
  ownDivision: boolean;
  receiveTicketEmail: boolean;
  accountManagerId: string;
  accountManagerName: string;
  defaultAssigneeId: string;
  defaultAssigneeName: string;
  defaultSupervisorId: string;
  defaultSupervisorName: string;
  numberOfPersons: number;
  numberOfDevices: number;
  accountManager: Person | null;
  parent: Organisation | null;
}

export interface DeviceStatus {
  deviceId: string;
  online: boolean;
  hasNotice: boolean;
  noticeInfo: string[];
  hasMinorIssue: boolean;
  minorIssueInfo: string[];
  hasMajorIssue: boolean;
  majorIssueInfo: string[];
  hasBlockingIssue: boolean;
  blockingInfo: string[];
  state: string;
  storedState: string;
  fieldTest: boolean;
  deviceForSpecialUseCases: boolean;
  hasAttentionRequired: boolean;
  attentionRequiredInfo: string[];
}

export interface Device {
  id: string;
  ecuId: string;
  organisationId: string;
  organisationName: string;
  serial: string;
  serialAlias: string;
  ecuSerial: string;
  alias: string;
  deviceVersion: string;
  deviceVersionAsBuild: string;
  deviceName: string;
  mac: string;
  ethernetMac: string;
  hardwareVersion: string;
  bootVersion: string;
  deviceTypeId: string;
  baseType: string;
  type: string;
  subType: string;
  voltage: string;
  color: string;
  status: string;
  address: string;
  address1: string;
  address2: string;
  postalCode: string;
  city: string;
  region: string;
  countryId: string;
  country: string;
  longitude: number;
  latitude: number;
  inletManifoldType: string;
  toilet: boolean;
  connectedToilets: number;
  washingMachine: boolean;
  auxiliary: boolean;
  auxiliaryOptionAvailable: boolean;
  hasTransferUpgradeKit: boolean;
  liftPumpBefore: boolean;
  liftPumpAfter: boolean;
  targetBranch: string;
  dealer: string;
  purchaseOrder: string;
  productionOrder: string;
  invoice: string;
  notes: string;
  lastOnline: string;
  currentBranch: string;
  firmwareVersion: string;
  firmwareCoreVersion: string | null;
  wifiVersion: string;
  manual: boolean;
  online: boolean;
  factoryTestCompletedDate: string;
  verificationDate: string;
  commissionDate: string;
  endOfWarranty: string;
  neighbourGroupId: string;
  neighbourGroupName: string;
  cascadeGroupId: string;
  cascadeGroupName: string;
  cascadeGroupConnectedT3: boolean;
  cascadeGroupExternalDistPump: boolean;
  cascadeGroupNumber: number;
  maintenancePeriod: number;
  nextMaintenanceDate: string;
  maintenancePlannedDate: string;
  lastMaintenanceDate: string;
  lastMaintenanceType: string;
  nickname: string;
  ownerId: string;
  ownerName: string;
  owner: Person;
  neighborDevices: Device[];
  timezones: string[];
  organisation: Organisation;
  organisations: string[];
  boardVersions: string[];
  settings: Record<string, unknown>;
  deviceStatus: DeviceStatus;
  localApiUrl: string;
  localServerId: string;
  kits: string[];
  kitNumbers: string[];
  vpnAddress: string;
  vpnAddressUpdated: string;
}

export interface WaterRecycledEntry {
  timestamp: string;
  liters: number;
}

export interface WaterIntakeOfHouseEntry {
  timestamp: string;
  liters: number;
}

export interface WaterRecycledRecords {
  waterRecycled: WaterRecycledEntry[];
  waterIntakeOfHouse: WaterIntakeOfHouseEntry[];
}

export interface TankLevel {
  /** UTC ISO 8601 timestamp */
  timestamp: string;
  /** Integer 0-100, same window definition as the device dashboard */
  percentage: number;
  /** Calibrated liters, one decimal */
  liters: number;
}

export interface TankLevels {
  tank2: TankLevel | null;
  /** H600 only, `null` for other device types */
  tank2b: TankLevel | null;
  tank3: TankLevel | null;
}

export interface TankLevelsByMonth {
  tank2: TankLevel[];
  /** H600 only, empty for other device types */
  tank2b: TankLevel[];
  tank3: TankLevel[];
}

export interface BypassMode {
  bypassActive: boolean;
  minutesRemaining: number;
  remaining: string;
}

export interface State {
  apiKey: string;
  rootApiUrl: string;
  deviceLocalApiUrls: Map<string, string>;
}

export declare const VERSION: string;

export declare class RequestError extends Error {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: any;
  };
  response: {
    url: string;
    status: number;
    headers: Record<string, string>;
    body: string;
  };
  constructor(
    message: string,
    options: {
      request: RequestError["request"];
      response: RequestError["response"];
    },
  );
}

export declare class Hydraloop {
  static VERSION: string;
  constructor(options: HydraloopOptions);

  listDevices(): Promise<Device[]>;
  getRecycledWaterByYear(options: {
    deviceId: string;
    year: number;
  }): Promise<WaterRecycledRecords>;
  getRecycledWaterByMonth(options: {
    deviceId: string;
    year: number;
    month: number;
  }): Promise<WaterRecycledRecords>;
  getTankLevels(options: { deviceId: string }): Promise<TankLevels>;
  getTankLevelsByMonth(options: {
    deviceId: string;
    year: number;
    month: number;
  }): Promise<TankLevelsByMonth>;
  getBypassMode(options: { deviceId: string }): Promise<BypassMode>;
  setBypassMode(options: {
    deviceId: string;
    activate: boolean;
  }): Promise<void>;
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      HYDRALOOP_API_KEY: string;
    }
  }
}
