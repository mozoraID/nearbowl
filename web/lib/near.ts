import { config } from "./config";

type RpcResponse<T> = {
  result?: T;
  error?: { message?: string; data?: string };
};

export async function view<T>(contractId: string, method: string, args: object): Promise<T> {
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "nearbowl",
      method: "query",
      params: {
        request_type: "call_function",
        account_id: contractId,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
        finality: "optimistic",
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`NetworkError ${response.status}`);
  }
  const body = (await response.json()) as RpcResponse<{ result?: number[] }>;
  if (body.error) {
    throw new Error(body.error.data || body.error.message || "RPC error");
  }
  const bytes = body.result?.result ?? [];
  const text = new TextDecoder().decode(Uint8Array.from(bytes));
  return JSON.parse(text) as T;
}
