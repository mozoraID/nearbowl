const MESSAGES: Record<string, string> = {
  UnexpectedToken: "That token is not the USDC this factory accepts. The transfer was returned.",
  InvalidMsg: "The request could not be read. Check the name, symbol, and amount.",
  CoinNotFound: "That coin does not exist.",
  CoinDead: "This coin has already died. Trading is closed; holders can claim.",
  CoinAlive: "This coin is still alive. A claim opens when the timer reaches zero.",
  SeedTooSmall: "The seed is below the minimum. On the demo timer that minimum is 1 USDC.",
  LaunchStorageInsufficient: "Your factory storage balance is too low to launch. Deposit NEAR first.",
  PositionStorageInsufficient: "Your factory storage balance is too low to open a position. Deposit a little NEAR first.",
  SymbolInvalid: "Symbols are 3–10 letters or numbers.",
  SymbolReserved: "That ticker is reserved. Pick another name.",
  SymbolTaken: "That ticker is already used. Symbols are never reused, even after a coin dies.",
  TradeTooSmallForMint: "That amount is too small to mint or to pay out.",
  SlippageExceeded: "The quote moved before the trade landed. Check the quote and try again.",
  InsufficientBalance: "You do not have that many tokens to sell.",
  NothingToClaim: "There is nothing here to claim.",
  ReceiverNotRegistered: "That account is not registered on USDC yet. Register it with a small NEAR deposit, then try again.",
  PayoutInFlight: "A payout for this account is already in progress. Wait for it to finish.",
  Unauthorized: "Only the coin's creator or the factory owner can do that.",
  DemoControlsDisabled: "Demo controls are off on this factory.",
  FeeParamsInvalid: "The factory was initialized with fee parameters that do not add up.",
  NeedOneYocto: "This action needs a tiny NEAR deposit attached. Try again from the app.",
  NotEnoughGas: "The transaction did not include enough gas. Try again.",
  AmountOverflow: "That amount is too large for the contract to handle safely.",
  FaucetCooldown: "The faucet was used recently. Wait a minute and try again.",
  InsufficientDeposit: "Attach enough NEAR to cover storage.",
  SenderNotRegistered: "Your account is not registered on tUSDC yet.",
};

export function humanError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  for (const [code, message] of Object.entries(MESSAGES)) {
    if (text.includes(code)) return message;
  }
  if (text.includes("User rejected") || text.includes("User cancelled") || text.includes("User closed")) {
    return "The wallet closed the request.";
  }
  if (text.toLowerCase().includes("failed to fetch") || text.includes("NetworkError")) {
    return "The network request did not go through. Check your connection and try again.";
  }
  const cleaned = text.replace(/^Error:\s*/, "").trim();
  if (cleaned.length > 0 && cleaned.length < 220 && !cleaned.includes("panicked") && !cleaned.includes("{")) {
    return cleaned;
  }
  return "That did not go through. Please try again.";
}
