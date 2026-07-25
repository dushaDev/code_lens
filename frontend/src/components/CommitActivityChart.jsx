import React, { useState, useEffect } from 'react';

export default function CommitActivityChart({ commits, allCommits, authorName }) {
  const sourceForBounds = allCommits || commits;

  const initDates = (src) => {
    if (!src || src.length === 0) return { s: '', e: '' };
    const sorted = [...src].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return {
      s: sorted[0].timestamp.split('T')[0],
      e: sorted[sorted.length - 1].timestamp.split('T')[0],
    };
  };

  const { s: initStart, e: initEnd } = initDates(sourceForBounds);
  const [chartInterval, setChartInterval] = useState('weekly');
  const [startDate, setStartDate] = useState(initStart);
  const [endDate, setEndDate] = useState(initEnd);

  // Re-init date bounds when the commits change (author switch resets to full range)
  useEffect(() => {
    const { s, e } = initDates(sourceForBounds);
    setStartDate(s);
    setEndDate(e);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorName]);

  if (!commits || commits.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '220px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        {authorName ? `No commits found for ${authorName}.` : 'No commits recorded to plot activity history.'}
      </div>
    );
  }

  const filteredCommits = commits.filter(c => {
    const ts = c.timestamp.split('T')[0];
    if (startDate && ts < startDate) return false;
    if (endDate && ts > endDate) return false;
    return true;
  });

  const setQuickRange = (days) => {
    const sorted = [...sourceForBounds].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (sorted.length === 0) return;
    const latestDateStr = sorted[sorted.length - 1].timestamp.split('T')[0];
    const latestDate = new Date(latestDateStr);
    if (days === 'all') {
      setStartDate(sorted[0].timestamp.split('T')[0]);
      setEndDate(latestDateStr);
    } else {
      const priorDate = new Date(latestDate);
      priorDate.setDate(priorDate.getDate() - days);
      const priorStr = priorDate.toISOString().split('T')[0];
      const earliestStr = sorted[0].timestamp.split('T')[0];
      setStartDate(priorStr < earliestStr ? earliestStr : priorStr);
      setEndDate(latestDateStr);
    }
  };

  const start = new Date(startDate || new Date());
  const end = new Date(endDate || new Date());
  const chartData = [];

  if (chartInterval === 'monthly') {
    let curr = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
    while (curr <= endMonth) {
      const label = curr.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
      const nextMonth = new Date(curr.getFullYear(), curr.getMonth() + 1, 1);
      const count = filteredCommits.filter(c => { const d = new Date(c.timestamp); return d >= curr && d < nextMonth; }).length;
      chartData.push({ label, count, tooltip: `${label}: ${count} commits` });
      curr = nextMonth;
    }
  } else if (chartInterval === 'weekly') {
    let curr = new Date(start);
    curr.setDate(curr.getDate() - curr.getDay());
    while (curr <= end) {
      const weekEnd = new Date(curr);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const label = curr.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const count = filteredCommits.filter(c => { const d = new Date(c.timestamp); return d >= curr && d <= weekEnd; }).length;
      chartData.push({ label, count, tooltip: `${curr.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}: ${count} commits` });
      curr.setDate(curr.getDate() + 7);
    }
  } else {
    let curr = new Date(start);
    while (curr <= end) {
      const label = curr.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const dateStr = curr.toDateString();
      const count = filteredCommits.filter(c => new Date(c.timestamp).toDateString() === dateStr).length;
      chartData.push({ label, count, tooltip: `${curr.toLocaleDateString(undefined, { dateStyle: 'medium' })}: ${count} commits` });
      curr.setDate(curr.getDate() + 1);
    }
  }

  const maxVal = Math.max(...chartData.map(d => d.count), 1);
  const width = 600, height = 180;
  const paddingLeft = 15, paddingRight = 55, paddingTop = 15, paddingBottom = 25;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const barSpacing = chartWidth / Math.max(chartData.length, 1);
  const barWidth = Math.max(barSpacing * 0.6, 4);
  const totalSelectedCommits = filteredCommits.length;
  const avgCommits = (totalSelectedCommits / Math.max(chartData.length, 1)).toFixed(1);
  const barColor = 'var(--primary)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Quick range + interval toggle */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          {[30, 90, 'all'].map(d => (
            <button key={d} type="button" className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.75rem', height: 'auto' }}
              onClick={() => setQuickRange(d)}>
              {d === 'all' ? 'All Time' : `${d} Days`}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-app)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
          {['daily', 'weekly', 'monthly'].map(t => (
            <button key={t} type="button"
              style={{ padding: '4px 10px', fontSize: '0.75rem', border: 'none', background: chartInterval === t ? 'var(--bg-card)' : 'transparent', color: chartInterval === t ? 'var(--primary)' : 'var(--text-muted)', fontWeight: chartInterval === t ? '600' : 'normal', borderRadius: '4px', cursor: 'pointer', boxShadow: chartInterval === t ? 'var(--shadow-sm)' : 'none' }}
              onClick={() => setChartInterval(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Date pickers */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>From:</span>
          <input type="date" className="input-field" style={{ padding: '4px 8px', fontSize: '0.8rem', width: '130px', height: 'auto' }} value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>To:</span>
          <input type="date" className="input-field" style={{ padding: '4px 8px', fontSize: '0.8rem', width: '130px', height: 'auto' }} value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>

      {/* SVG chart */}
      <div style={{ position: 'relative', width: '100%', minHeight: '190px', padding: '10px 0', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--bg-app)' }}>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
            const y = paddingTop + chartHeight * (1 - ratio);
            return (
              <g key={i}>
                <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="var(--border-color)" strokeWidth="0.75" strokeDasharray="4 4" />
                <text x={width - paddingRight + 8} y={y + 3} textAnchor="start" fontSize="9px" fill="var(--text-muted)" fontWeight="600">{Math.round(maxVal * ratio)}</text>
              </g>
            );
          })}
          <text transform={`rotate(90, ${width - 15}, ${paddingTop + chartHeight / 2})`} x={width - 15} y={paddingTop + chartHeight / 2} textAnchor="middle" fontSize="9px" fontWeight="600" fill="var(--text-muted)" letterSpacing="0.05em">Commits</text>
          {chartData.map((d, i) => {
            const x = paddingLeft + i * barSpacing + (barSpacing - barWidth) / 2;
            const barH = (d.count / maxVal) * chartHeight;
            const y = paddingTop + chartHeight - barH;
            const showLabel = chartData.length <= 12 || i % Math.ceil(chartData.length / 10) === 0;
            return (
              <g key={i} className="chart-bar-group">
                <rect x={x} y={y} width={barWidth} height={Math.max(barH, 2)} rx="1.5" ry="1.5" fill={barColor} style={{ transition: 'all 0.3s ease', cursor: 'pointer' }} />
                <rect x={x - (barSpacing - barWidth) / 2} y={paddingTop} width={barSpacing} height={chartHeight} fill="transparent" style={{ cursor: 'pointer' }}>
                  <title>{d.tooltip}</title>
                </rect>
                {showLabel && <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" fontSize="8.5px" fill="var(--text-muted)">{d.label}</text>}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Selected Range Commits</div>
          <strong style={{ fontSize: '1.05rem', color: 'var(--text-main)' }}>{totalSelectedCommits}</strong>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Avg Commits/{chartInterval}</div>
          <strong style={{ fontSize: '1.05rem', color: 'var(--primary)' }}>{avgCommits}</strong>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Peak {chartInterval === 'monthly' ? 'Month' : chartInterval === 'weekly' ? 'Week' : 'Day'}</div>
          <strong style={{ fontSize: '1.05rem', color: 'var(--text-main)' }}>{maxVal}</strong>
        </div>
      </div>
    </div>
  );
}
