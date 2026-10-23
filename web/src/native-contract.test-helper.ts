import type { ArrivalPage, ArrivalSettings, Device, SendRouting } from './types'
import { readFileSync } from 'node:fs'

interface FixtureConfig { baseUrl: string; sourceDevice: string; connected: boolean;deviceId?: string;platform?: 'macos'|'linux'|'android' }
interface FixtureResponse { status: number; body: string; headers: Record<string,string> }
interface NativeContractFixture {
  device: Device;sendRouting: SendRouting;arrivalSettings: ArrivalSettings;arrivalPage: ArrivalPage;arrivalTarget:{baseUrl:string;itemId:string};
  config: FixtureConfig;
  unpairedConfig: FixtureConfig;
  apiRequest: { method: string; path: string; requestId: string };
  apiResponse: FixtureResponse;
  noContentResponse: FixtureResponse;
  queue: { id: string; direction: 'upload'|'download'; name: string; size: number; offset: number; status: string; itemId?: string; error?: string }[];
  states: Record<string,string|null>;
}
// Read the single native-owned fixture when tests execute. Production web-only
// build contexts typecheck tests without needing to copy the clients directory.
const fixture = JSON.parse(readFileSync('../clients/shared/native-contract-fixture.json','utf8')) as NativeContractFixture
export default fixture
