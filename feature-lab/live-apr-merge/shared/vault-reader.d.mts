export function readVault(job: any, rpc: (method: string, params: any[]) => Promise<any>, options?: { confirmations?: number; now?: () => number }): Promise<any>
export function readPosition(snapshot: any, wallet: string, rpc: (method: string, params: any[]) => Promise<any>): Promise<any>
