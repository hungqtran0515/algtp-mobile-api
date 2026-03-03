// ============================================================================
// 🎯 ALGTP™ — Box Component (3-Tier Layer System)
// React Component for Small Cap 3-Layer filtering profile
// ============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import styles from './Box.module.css';

const POLL_MS = 5000; // 5 second polling interval

export default function Box() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  
  // Feed state for each tier: L1 (TRIG), L2 (CONF), L3 (BRK)
  const [feed, setFeed] = useState({ 1: [], 2: [], 3: [] });
  
  // Bell counters for each tier
  const [tierBell, setTierBell] = useState({ 1: 0, 2: 0, 3: 0 });
  
  // Cap category bell counters (SC = Small Cap, MC = Mid Cap, LC = Large Cap)
  const [capBell, setCapBell] = useState({ sc: 0, mc: 0, lc: 0 });
  
  // Table rows for all tickers across layers
  const [tableRows, setTableRows] = useState([]);
  
  const intervalRef = useRef(null);

  // Fetch data from API
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/box-feed');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      if (data.ok) {
        // Update feed by tier
        setFeed({
          1: data.tiers?.l1 || [],
          2: data.tiers?.l2 || [],
          3: data.tiers?.l3 || [],
        });
        
        // Update tier bell counts
        setTierBell({
          1: data.bellCounts?.l1 || 0,
          2: data.bellCounts?.l2 || 0,
          3: data.bellCounts?.l3 || 0,
        });
        
        // Update cap bell counts
        setCapBell({
          sc: data.bellCounts?.sc || 0,
          mc: data.bellCounts?.mc || 0,
          lc: data.bellCounts?.lc || 0,
        });
        
        // Update table rows
        setTableRows(data.tableRows || []);
        setError(null);
      } else {
        setError(data.error || 'Unknown error');
      }
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // Start polling
  const start = useCallback(() => {
    if (running) return;
    setRunning(true);
    fetchData();
    intervalRef.current = setInterval(fetchData, POLL_MS);
  }, [running, fetchData]);

  // Stop polling
  const stop = useCallback(() => {
    setRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Clear all data
  const clearAll = useCallback(() => {
    setFeed({ 1: [], 2: [], 3: [] });
    setTierBell({ 1: 0, 2: 0, 3: 0 });
    setCapBell({ sc: 0, mc: 0, lc: 0 });
    setTableRows([]);
    setError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.left}>
          <span className={styles.title}>🎯 3-Layer Box</span>
          <button className={`${styles.btn} ${styles.primary}`} onClick={start} disabled={running}>▶ Start</button>
          <button className={styles.btn} onClick={stop} disabled={!running}>⏸ Stop</button>
          <button className={`${styles.btn} ${styles.ghost}`} onClick={clearAll}>Clear</button>
        </div>

        <div className={styles.right}>
          <span className={`${styles.capBell} ${styles.sc}`}>🔔 SC: <b>{capBell.sc}</b></span>
          <span className={`${styles.capBell} ${styles.mc}`}>🔔 MID: <b>{capBell.mc}</b></span>
          <span className={`${styles.capBell} ${styles.lc}`}>🔔 LC: <b>{capBell.lc}</b></span>
        </div>
      </div>

      {error ? <div className={styles.error}>⚠ {error}</div> : null}

      <div className={styles.row}>
        <TierCard title="⚡ L1 • TRIG" bell={tierBell[1]} items={feed[1]} />
        <TierCard title="✅ L2 • CONF" bell={tierBell[2]} items={feed[2]} />
        <TierCard title="🚀 L3 • BRK" bell={tierBell[3]} items={feed[3]} />
      </div>

      <div className={styles.tableWrap}>
        <div className={styles.tableTitle}>📊 Ticker List (All Layers)</div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr><th>Symbol</th><th>Cap</th><th>Tier</th></tr>
            </thead>
            <tbody>
              {tableRows.length ? tableRows.map((r, i) => (
                <tr key={`${r.sym}-${r.cap}-${r.tier}-${i}`}>
                  <td><b>{r.sym}</b></td>
                  <td className={r.cap === "SC" ? styles.scTxt : r.cap === "MC" ? styles.mcTxt : styles.lcTxt}>{r.cap}</td>
                  <td>{r.tier}</td>
                </tr>
              )) : <tr><td colSpan={3} className={styles.empty}>--</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TierCard({ title, bell, items }) {
  return (
    <div className={title.includes("TRIG") ? `${styles.tier} ${styles.t1}` : title.includes("CONF") ? `${styles.tier} ${styles.t2}` : `${styles.tier} ${styles.t3}`}>
      <div className={styles.tierHead}>
        <span>{title}</span>
        <span className={styles.tierBell}>🔔 {bell}</span>
      </div>
      <div className={styles.feed}>
        {items.length ? items.map((x, idx) => (
          <div className={styles.chip} key={`${x.sym}-${x.ts}-${idx}`}>
            <b>{x.sym}</b>
            <span className={styles.tag}>{x.tag}</span>
          </div>
        )) : <div className={styles.muted}>--</div>}
      </div>
    </div>
  );
}
