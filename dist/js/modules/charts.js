(function (global) {
  'use strict';

  const namespace = global.EquiCoach || (global.EquiCoach = {});
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const maxRides = 8;
  const gaitSeries = [
    { key: 'walk', label: 'Schritt', color: '#4FAE8A' },
    { key: 'trot', label: 'Trab', color: '#D4AF37' },
    { key: 'canter', label: 'Galopp', color: '#6386D6' }
  ];

  function createSvgElement(name, attributes = {}) {
    const element = document.createElementNS(svgNamespace, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function appendText(parent, text, attributes = {}) {
    const element = createSvgElement('text', attributes);
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function normalizeRide(entry) {
    const rating = Number(entry?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 6) return null;

    const minutes = {};
    gaitSeries.forEach(({ key }) => {
      const value = Number(entry[key]);
      minutes[key] = Number.isFinite(value) && value > 0 ? value : 0;
    });

    return {
      date: typeof entry.date === 'string' && entry.date.trim() ? entry.date.trim() : 'Unbekannt',
      rating,
      minutes,
      totalMinutes: Object.values(minutes).reduce((total, value) => total + value, 0)
    };
  }

  function renderRideHistoryChart(container, history) {
    if (!container) throw new Error('Das Diagramm-Ziel für die Rittanalyse fehlt.');
    container.replaceChildren();

    const rides = (Array.isArray(history) ? history : [])
      .map(normalizeRide)
      .filter(Boolean)
      .slice(0, maxRides)
      .reverse();

    if (!rides.length) {
      const message = document.createElement('p');
      message.className = 'chart-description';
      message.textContent = 'Für die gemeinsame Grafik werden gespeicherte Ritte mit einer Bewertung von 1 bis 6 benötigt.';
      container.appendChild(message);
      return;
    }

    const width = Math.max(340, rides.length * 44 + 36);
    const height = 232;
    const left = 28;
    const right = width - 12;
    const ratingTop = 42;
    const ratingBottom = 101;
    const barTop = 144;
    const barBottom = 187;
    const xForRide = index => rides.length === 1
      ? (left + right) / 2
      : left + index * (right - left) / (rides.length - 1);
    const yForRating = rating => ratingBottom - ((rating - 1) / 5) * (ratingBottom - ratingTop);
    const svg = createSvgElement('svg', {
      class: 'ride-history-chart',
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-labelledby': 'rideChartTitle rideChartDescription'
    });
    const title = createSvgElement('title', { id: 'rideChartTitle' });
    title.textContent = `Bewertungen und Gangartenverteilung der letzten ${rides.length} Ritte`;
    svg.appendChild(title);
    const description = createSvgElement('desc', { id: 'rideChartDescription' });
    description.textContent = 'Die gelbe Linie zeigt die selbst vergebene Bewertung auf der App-Skala von 1 bis 6. Die darunterliegenden gestapelten Balken zeigen die prozentualen Anteile von Schritt, Trab und Galopp.';
    svg.appendChild(description);

    appendText(svg, 'Note', { x: 2, y: 29, class: 'ride-chart-axis' });
    [1, 3, 6].forEach(rating => {
      const y = yForRating(rating);
      svg.appendChild(createSvgElement('line', {
        x1: left,
        x2: right,
        y1: y,
        y2: y,
        class: 'ride-chart-grid'
      }));
      appendText(svg, String(rating), {
        x: left - 7,
        y: y + 3,
        'text-anchor': 'end',
        class: 'ride-chart-axis'
      });
    });

    const ratingPoints = rides.map((ride, index) => ({
      x: xForRide(index),
      y: yForRating(ride.rating),
      ride
    }));
    if (ratingPoints.length > 1) {
      svg.appendChild(createSvgElement('polyline', {
        points: ratingPoints.map(point => `${point.x},${point.y}`).join(' '),
        class: 'ride-chart-rating-line'
      }));
    }

    ratingPoints.forEach(({ x, y, ride }) => {
      const point = createSvgElement('circle', {
        cx: x,
        cy: y,
        r: 4,
        class: 'ride-chart-rating-point'
      });
      const title = createSvgElement('title');
      title.textContent = `${ride.date}: Bewertung ${ride.rating}/6`;
      point.appendChild(title);
      svg.appendChild(point);
      appendText(svg, String(ride.rating), {
        x,
        y: y - 8,
        'text-anchor': 'middle',
        class: 'ride-chart-label'
      });
    });

    appendText(svg, 'Gangartenanteil', { x: 2, y: 132, class: 'ride-chart-axis' });
    svg.appendChild(createSvgElement('line', {
      x1: left,
      x2: right,
      y1: barBottom,
      y2: barBottom,
      class: 'ride-chart-grid'
    }));

    const barWidth = Math.min(22, (right - left) / rides.length * 0.48);
    rides.forEach((ride, index) => {
      const x = xForRide(index);
      let segmentBottom = barBottom;
      if (ride.totalMinutes > 0) {
        gaitSeries.forEach(series => {
          const value = ride.minutes[series.key];
          if (!value) return;
          const segmentHeight = (value / ride.totalMinutes) * (barBottom - barTop);
          const segment = createSvgElement('rect', {
            x: x - barWidth / 2,
            y: segmentBottom - segmentHeight,
            width: barWidth,
            height: segmentHeight,
            fill: series.color
          });
          const title = createSvgElement('title');
          const percentage = Math.round(value / ride.totalMinutes * 100);
          title.textContent = `${ride.date}: ${series.label} ${percentage}% (${value.toFixed(1)} min) · Bewertung ${ride.rating}/6`;
          segment.appendChild(title);
          svg.appendChild(segment);
          segmentBottom -= segmentHeight;
        });
      }

      const dateLabel = ride.date.split(',')[0].slice(0, 10);
      appendText(svg, dateLabel, {
        x,
        y: 204,
        'text-anchor': 'middle',
        class: 'ride-chart-axis'
      });
      if (ride.totalMinutes === 0) {
        appendText(svg, '—', {
          x,
          y: barBottom - 4,
          'text-anchor': 'middle',
          class: 'ride-chart-axis'
        });
      }
    });

    container.appendChild(svg);
    const legend = document.createElement('div');
    legend.className = 'ride-chart-legend';
    const legendItems = [
      ...gaitSeries.map(series => ({ label: series.label, className: series.key })),
      { label: 'Bewertung (1–6)', className: 'rating' }
    ];
    legendItems.forEach(item => {
      const legendItem = document.createElement('span');
      legendItem.className = 'ride-chart-legend-item';
      const swatch = document.createElement('span');
      swatch.className = `ride-chart-swatch ${item.className}`;
      swatch.setAttribute('aria-hidden', 'true');
      legendItem.appendChild(swatch);
      legendItem.appendChild(document.createTextNode(item.label));
      legend.appendChild(legendItem);
    });
    container.appendChild(legend);
  }

  function renderMotionAnalysisChart(container, analysis) {
    if (!container) throw new Error('Das Diagramm-Ziel für die Sensoranalyse fehlt.');
    container.replaceChildren();

    const gaits = [
      { key: 'walk', label: 'Schritt' },
      { key: 'trot', label: 'Trab' },
      { key: 'canter', label: 'Galopp' }
    ].map(gait => ({ ...gait, stats: analysis?.[gait.key] }))
      .filter(gait => gait.stats && Number.isSafeInteger(gait.stats.windows) && gait.stats.windows > 0);

    if (!gaits.length) {
      const message = document.createElement('p');
      message.className = 'chart-description';
      message.textContent = 'Noch keine auswertbaren kalibrierten Sensorfenster.';
      container.appendChild(message);
      return;
    }

    const chart = document.createElement('div');
    chart.className = 'motion-analysis-chart';
    chart.setAttribute('role', 'group');
    chart.setAttribute('aria-label', 'Kalibrierte Rhythmus- und Beschleunigungsanalyse je Gangart');
    const dynamicsScale = 2;

    gaits.forEach(({ key, label, stats }) => {
      const row = document.createElement('section');
      row.className = 'motion-gait-row';
      const heading = document.createElement('h4');
      heading.textContent = `${label} · ${stats.windows} Fenster`;
      row.appendChild(heading);

      const irregularity = Number.isFinite(stats.irregularityPercent)
        ? Math.min(100, Math.max(0, stats.irregularityPercent))
        : null;
      const dynamicsRatio = Number.isFinite(stats.averageDynamicsRatio)
        ? Math.max(0, stats.averageDynamicsRatio)
        : null;

      row.appendChild(createMetricBar(
        'Rhythmusauffälligkeiten',
        irregularity,
        irregularity === null ? '—' : `${irregularity.toFixed(1)}%`,
        null,
        key
      ));

      row.appendChild(createMetricBar(
        'Beschleunigungsdynamik',
        dynamicsRatio === null ? null : Math.min(100, dynamicsRatio / dynamicsScale * 100),
        dynamicsRatio === null ? '—' : `${dynamicsRatio.toFixed(2)}×`,
        1.25 / dynamicsScale * 100,
        key
      ));
      chart.appendChild(row);
    });

    container.appendChild(chart);
    const legend = document.createElement('div');
    legend.className = 'motion-chart-legend';
    const items = [
      { label: 'Rhythmus: Anteil auffälliger Fenster', type: 'irregularity' },
      { label: 'Dynamik: Faktor zur Kalibrierung', type: 'dynamics' },
      { label: 'Schwunghinweis ab 1,25×', type: 'threshold' }
    ];
    items.forEach(item => {
      const entry = document.createElement('span');
      entry.className = 'motion-chart-legend-item';
      const swatch = document.createElement('span');
      swatch.className = `motion-chart-swatch ${item.type}`;
      swatch.setAttribute('aria-hidden', 'true');
      entry.appendChild(swatch);
      entry.appendChild(document.createTextNode(item.label));
      legend.appendChild(entry);
    });
    container.appendChild(legend);
  }

  function createMetricBar(label, percentage, valueLabel, threshold, gait) {
    const metric = document.createElement('div');
    metric.className = 'motion-metric';
    const header = document.createElement('div');
    header.className = 'motion-metric-header';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('strong');
    value.textContent = valueLabel;
    header.append(name, value);
    metric.appendChild(header);

    const track = document.createElement('div');
    track.className = `motion-track motion-${gait}`;
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', `${label}: ${valueLabel}`);
    if (threshold !== null) {
      const marker = document.createElement('span');
      marker.className = 'motion-threshold';
      marker.style.left = `${threshold}%`;
      marker.setAttribute('aria-hidden', 'true');
      track.appendChild(marker);
    }
    if (percentage !== null) {
      const fill = document.createElement('span');
      fill.className = 'motion-fill';
      fill.style.width = `${percentage}%`;
      track.appendChild(fill);
    }
    metric.appendChild(track);
    return metric;
  }

  namespace.Charts = { renderRideHistoryChart, renderMotionAnalysisChart };
})(window);