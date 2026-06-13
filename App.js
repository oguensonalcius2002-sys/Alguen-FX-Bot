import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  ScrollView, StyleSheet, StatusBar, SafeAreaView
} from 'react-native';

const PAIRS = ['EUR/USD', 'GBP/USD', 'AUD/USD', 'XAU/USD', 'BTC/USD', 'ETH/USD'];
const DURATIONS = [{ l: '30s', v: 30 }, { l: '1m', v: 60 }, { l: '5m', v: 300 }, { l: '15m', v: 900 }];

function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const changes = prices.slice(-period - 1).map((p, i, a) => i === 0 ? 0 : p - a[i - 1]).slice(1);
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? -c : 0);
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcMACD(prices) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  if (!ema12 || !ema26) return null;
  return ema12 - ema26;
}

function analyzeAll(candles) {
  if (candles.length < 30) return { dir: 'WAIT', conf: 0 };
  const closes = candles.map(c => c.close);
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const price = closes[closes.length - 1];
  const sorted = [...closes.slice(-20)].sort((a, b) => a - b);
  const support = sorted[Math.floor(sorted.length * 0.1)];
  const resistance = sorted[Math.floor(sorted.length * 0.9)];

  let bull = 0, bear = 0;
  if (ema9 && ema21) ema9 > ema21 ? bull++ : bear++;
  if (rsi !== null) {
    if (rsi < 30) bull += 2;
    else if (rsi > 70) bear += 2;
  }
  if (macd !== null) macd > 0 ? bull++ : bear++;
  const distSup = Math.abs(price - support) / price;
  const distRes = Math.abs(resistance - price) / price;
  if (distSup < 0.002) bull++;
  else if (distRes < 0.002) bear++;

  let dir = 'WAIT', conf = 0;
  if (bull >= 3) { dir = 'CALL'; conf = Math.min(Math.round((bull / 5) * 100), 95); }
  else if (bear >= 3) { dir = 'PUT'; conf = Math.min(Math.round((bear / 5) * 100), 95); }

  return { dir, conf, rsi: rsi?.toFixed(1), macd: macd?.toFixed(5), bull, bear };
}

function genCandle(prev) {
  const open = prev.close;
  const close = +(open + (Math.random() - 0.48) * 0.0012).toFixed(5);
  const high = +(Math.max(open, close) + Math.random() * 0.0004).toFixed(5);
  const low = +(Math.min(open, close) - Math.random() * 0.0004).toFixed(5);
  return { open, close, high, low };
}

function initCandles(n = 60) {
  const arr = [{ open: 1.0843, close: 1.0843, high: 1.0845, low: 1.0841 }];
  for (let i = 1; i < n; i++) arr.push(genCandle(arr[i - 1]));
  return arr;
}

export default function App() {
  const [pair, setPair] = useState('EUR/USD');
  const [dur, setDur] = useState(60);
  const [amt, setAmt] = useState('10');
  const [candles, setCandles] = useState(initCandles);
  const [signal, setSignal] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [trades, setTrades] = useState([]);
  const [balance, setBalance] = useState(500);
  const [tab, setTab] = useState('trade');
  const timer = useRef(null);

  const price = candles[candles.length - 1]?.close;
  const prevPrice = candles[candles.length - 2]?.close || price;
  const up = price >= prevPrice;

  useEffect(() => {
    const iv = setInterval(() => {
      setCandles(prev => [...prev.slice(-59), genCandle(prev[prev.length - 1])]);
    }, 1500);
    return () => clearInterval(iv);
  }, []);

  const scan = () => {
    setScanning(true);
    setTimeout(() => { setSignal(analyzeAll(candles)); setScanning(false); }, 1000);
  };

  const trade = (dir) => {
    const a = parseFloat(amt) || 10;
    if (a > balance || countdown > 0) return;
    setBalance(b => b - a);
    setCountdown(dur);
    const entry = price;
    timer.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(timer.current);
          setCandles(curr => {
            const exit = curr[curr.length - 1].close;
            const won = dir === 'CALL' ? exit > entry : exit < entry;
            const pnl = won ? +(a * 0.85).toFixed(2) : -a;
            setBalance(b => b + (won ? a + pnl : 0));
            setTrades(prev => [{ id: Date.now(), pair, dir, a, res: won ? 'WIN' : 'LOSS', pnl, t: new Date().toLocaleTimeString() }, ...prev.slice(0, 9)]);
            return curr;
          });
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const wins = trades.filter(t => t.res === 'WIN').length;
  const wr = trades.length ? Math.round(wins / trades.length * 100) : 0;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const sigColor = signal?.dir === 'CALL' ? '#00d26a' : signal?.dir === 'PUT' ? '#ff4757' : '#8b949e';

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />

      {/* Header */}
      <View style={s.hdr}>
        <Text style={s.logo}>Alguen <Text style={s.logoAccent}>FX</Text> Bot</Text>
        <View>
          <Text style={s.balLbl}>BALANS</Text>
          <Text style={s.balVal}>${balance.toFixed(2)}</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>

        {tab === 'trade' && (
          <View>
            {/* Price */}
            <View style={[s.card, { margin: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
              <View>
                <Text style={s.lbl}>{pair}</Text>
                <Text style={[s.priceBig, { color: up ? '#00d26a' : '#ff4757' }]}>{price?.toFixed(5)}</Text>
              </View>
              <Text style={{ fontSize: 28 }}>{up ? '▲' : '▼'}</Text>
            </View>

            {/* Pairs */}
            <View style={s.sec}>
              <Text style={s.lbl}>PÈ DEVIZ</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={s.row}>
                  {PAIRS.map(p => (
                    <TouchableOpacity key={p} style={[s.chip, pair === p && s.chipActive]} onPress={() => setPair(p)}>
                      <Text style={[s.chipTxt, pair === p && s.chipTxtActive]}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* Duration */}
            <View style={s.sec}>
              <Text style={s.lbl}>DIRE</Text>
              <View style={s.row}>
                {DURATIONS.map(d => (
                  <TouchableOpacity key={d.v} style={[s.chip, { flex: 1 }, dur === d.v && s.chipActive]} onPress={() => setDur(d.v)}>
                    <Text style={[s.chipTxt, dur === d.v && s.chipTxtActive]}>{d.l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Amount */}
            <View style={s.sec}>
              <Text style={s.lbl}>MONTAN ($)</Text>
              <TextInput style={s.input} value={amt} onChangeText={setAmt} keyboardType="numeric" placeholderTextColor="#8b949e" placeholder="10" />
            </View>

            {/* Scan */}
            <View style={s.sec}>
              <TouchableOpacity style={s.scanBtn} onPress={scan} disabled={scanning}>
                <Text style={s.scanTxt}>{scanning ? '⟳ Ap analize...' : '⚡ Analize Siy'}</Text>
              </TouchableOpacity>
            </View>

            {/* Signal */}
            {signal && (
              <View style={[s.card, { margin: 12, marginTop: 4 }]}>
                {signal.dir === 'WAIT' ? (
                  <Text style={{ color: '#8b949e', textAlign: 'center', padding: 8 }}>⏳ Tann — Pa gen siy kle</Text>
                ) : (
                  <>
                    <Text style={[s.sigDir, { color: sigColor }]}>
                      {signal.dir === 'CALL' ? '▲ MONTE (CALL)' : '▼ DESANN (PUT)'}
                    </Text>
                    <Text style={{ color: '#8b949e', fontSize: 12, marginTop: 2 }}>
                      Konfyans: <Text style={{ color: sigColor, fontWeight: '700' }}>{signal.conf}%</Text>
                      {'  '}🟢{signal.bull} vs 🔴{signal.bear}
                    </Text>
                    <View style={s.confBar}>
                      <View style={[s.confFill, { width: signal.conf + '%', backgroundColor: sigColor }]} />
                    </View>
                    <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                      <Text style={{ color: '#8b949e', fontSize: 11 }}>RSI: {signal.rsi}</Text>
                      <Text style={{ color: '#8b949e', fontSize: 11 }}>  MACD: {signal.macd}</Text>
                    </View>
                  </>
                )}

                {countdown > 0 ? (
                  <View style={s.countdownBox}>
                    <Text style={s.countdownTxt}>⏱ Trade aktif — {countdown}s rete</Text>
                  </View>
                ) : signal.dir !== 'WAIT' && (
                  <View style={[s.row, { marginTop: 8 }]}>
                    <TouchableOpacity style={[s.tradeBtn, s.callBtn]} onPress={() => trade('CALL')}>
                      <Text style={[s.tradeTxt, { color: '#00d26a' }]}>▲ CALL</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.tradeBtn, s.putBtn]} onPress={() => trade('PUT')}>
                      <Text style={[s.tradeTxt, { color: '#ff4757' }]}>▼ PUT</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {tab === 'stats' && (
          <View style={s.sec}>
            <View style={s.row}>
              {[['Trad', trades.length, '#a78bfa'], ['Win Rate', wr + '%', '#00d26a'], ['P&L', (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2), totalPnl >= 0 ? '#00d26a' : '#ff4757']].map(([l, v, c]) => (
                <View key={l} style={[s.card, { flex: 1, alignItems: 'center', padding: 10 }]}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: c }}>{v}</Text>
                  <Text style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>{l}</Text>
                </View>
              ))}
            </View>
            {trades.length === 0 ? (
              <Text style={{ color: '#8b949e', textAlign: 'center', padding: 24 }}>Pa gen trad ankò</Text>
            ) : trades.map(t => (
              <View key={t.id} style={[s.card, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }]}>
                <View>
                  <Text style={{ fontWeight: '700', color: '#e6edf3' }}>{t.pair} · {t.dir}</Text>
                  <Text style={{ fontSize: 11, color: '#8b949e' }}>{t.t} · ${t.a}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontWeight: '700', color: t.res === 'WIN' ? '#00d26a' : '#ff4757' }}>{t.res === 'WIN' ? '+' : ''}{t.pnl}$</Text>
                  <Text style={{ fontSize: 11, color: t.res === 'WIN' ? '#00d26a' : '#ff4757' }}>{t.res}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Tab Bar */}
      <View style={s.tabBar}>
        <TouchableOpacity style={s.tabItem} onPress={() => setTab('trade')}>
          <Text style={[s.tabTxt, tab === 'trade' && s.tabActive]}>📊 Trad</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.tabItem} onPress={() => setTab('stats')}>
          <Text style={[s.tabTxt, tab === 'stats' && s.tabActive]}>📋 Istwa</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0d1117' },
  hdr: { backgroundColor: '#161b22', borderBottomWidth: 1, borderBottomColor: '#21262d', padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: { fontSize: 16, fontWeight: '700', color: '#fff' },
  logoAccent: { color: '#7c3aed' },
  balLbl: { fontSize: 10, color: '#8b949e', textAlign: 'right' },
  balVal: { fontSize: 18, fontWeight: '700', color: '#00d26a' },
  sec: { paddingHorizontal: 12, paddingTop: 10 },
  lbl: { fontSize: 11, color: '#8b949e', marginBottom: 6, letterSpacing: 0.8 },
  row: { flexDirection: 'row', gap: 6 },
  card: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#21262d', borderRadius: 10, padding: 12 },
  chip: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#21262d', backgroundColor: '#161b22' },
  chipActive: { borderColor: '#7c3aed', backgroundColor: '#7c3aed22' },
  chipTxt: { color: '#8b949e', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  chipTxtActive: { color: '#a78bfa' },
  input: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#21262d', borderRadius: 8, padding: 10, color: '#e6edf3', fontSize: 16, fontWeight: '600' },
  scanBtn: { backgroundColor: '#7c3aed', borderRadius: 10, padding: 14, alignItems: 'center' },
  scanTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  priceBig: { fontSize: 24, fontWeight: '800' },
  sigDir: { fontSize: 20, fontWeight: '800' },
  confBar: { height: 4, backgroundColor: '#21262d', borderRadius: 2, marginTop: 8, overflow: 'hidden' },
  confFill: { height: '100%', borderRadius: 2 },
  countdownBox: { backgroundColor: '#7c3aed', borderRadius: 8, padding: 10, marginTop: 8, alignItems: 'center' },
  countdownTxt: { color: '#fff', fontWeight: '700' },
  tradeBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  callBtn: { borderColor: '#00d26a55', backgroundColor: '#00d26a15' },
  putBtn: { borderColor: '#ff475755', backgroundColor: '#ff475715' },
  tradeTxt: { fontSize: 15, fontWeight: '700' },
  tabBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#161b22', borderTopWidth: 1, borderTopColor: '#21262d', flexDirection: 'row' },
  tabItem: { flex: 1, padding: 14, alignItems: 'center' },
  tabTxt: { fontSize: 12, color: '#8b949e', fontWeight: '600' },
  tabActive: { color: '#a78bfa' },
});
  
