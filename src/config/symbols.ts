export interface SymbolMeta {
  symbol: string;
  name: string;
  group: 'crypto' | 'forex';
  decimals: number;
  pythId?: string;
  pythSymbol?: string;
}

export const CRYPTO_SYMBOLS: SymbolMeta[] = [
  { symbol: 'BTCUSDT', name: 'Bitcoin / USDT', group: 'crypto', decimals: 2 },
  { symbol: 'ETHUSDT', name: 'Ethereum / USDT', group: 'crypto', decimals: 2 },
  { symbol: 'SOLUSDT', name: 'Solana / USDT', group: 'crypto', decimals: 2 },
  { symbol: 'BNBUSDT', name: 'BNB / USDT', group: 'crypto', decimals: 2 },
  { symbol: 'XRPUSDT', name: 'XRP / USDT', group: 'crypto', decimals: 4 },
];

export const FOREX_SYMBOLS: SymbolMeta[] = [
  {
    symbol: 'XAUUSD',
    name: 'Vàng giao ngay (XAU/USD)',
    group: 'forex',
    decimals: 2,
    pythId: '765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2',
    pythSymbol: 'Metal.XAU/USD',
  },
  {
    symbol: 'XAGUSD',
    name: 'Bạc giao ngay (XAG/USD)',
    group: 'forex',
    decimals: 3,
    pythId: 'f2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e',
    pythSymbol: 'Metal.XAG/USD',
  },
  {
    symbol: 'EURUSD',
    name: 'EUR / USD',
    group: 'forex',
    decimals: 5,
    pythId: 'a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b',
    pythSymbol: 'FX.EUR/USD',
  },
  {
    symbol: 'GBPUSD',
    name: 'GBP / USD',
    group: 'forex',
    decimals: 5,
    pythId: '84c2dde9633d93d1bcad84e7dc41c9d56578b7ec52fabedc1f335d673df0a7c1',
    pythSymbol: 'FX.GBP/USD',
  },
  {
    symbol: 'USDJPY',
    name: 'USD / JPY',
    group: 'forex',
    decimals: 3,
    pythId: 'ef2c98c804ba503c6a707e38be4dfbb16683775f195b091252bf24693042fd52',
    pythSymbol: 'FX.USD/JPY',
  },
];

export const ALL_SYMBOLS: SymbolMeta[] = [...CRYPTO_SYMBOLS, ...FOREX_SYMBOLS];

export const SYMBOL_MAP = new Map<string, SymbolMeta>(
  ALL_SYMBOLS.map((s) => [s.symbol, s])
);

export const TIMEFRAMES = [
  { id: '1', label: '1m', ms: 60_000 },
  { id: '5', label: '5m', ms: 300_000 },
  { id: '15', label: '15m', ms: 900_000 },
  { id: '60', label: '1h', ms: 3_600_000 },
  { id: '240', label: '4h', ms: 14_400_000 },
  { id: 'D', label: '1D', ms: 86_400_000 },
] as const;

export function tfToMs(tf: string): number {
  return TIMEFRAMES.find((t) => t.id === tf)?.ms ?? 3_600_000;
}

export function formatPrice(price: number, symbol: string): string {
  const decimals = SYMBOL_MAP.get(symbol)?.decimals ?? 2;
  return price.toFixed(decimals);
}
