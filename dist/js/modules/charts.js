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
    chart.setAttribute('aria-label', 'Rhythmusdiagramm mit Balken, Intervallstreuung und Samples sowie Beschleunigungsdynamik je Gangart');

    appendMotionRhythmChart(chart, gaits);
    appendMotionLineChart(chart, gaits, {
      key: 'averageDynamicsRatio',
      title: 'Beschleunigungsdynamik (× Kalibrierungswert)',
      color: '#6386D6',
      max: Math.max(2, Math.ceil(Math.max(...gaits.map(({ stats }) =>
        Number.isFinite(stats.averageDynamicsRatio) ? stats.averageDynamicsRatio : 0
      )))),
      threshold: 1.25,
      format: value => `${value.toFixed(2)}×`
    });
    container.appendChild(chart);

    const legend = document.createElement('div');
    legend.className = 'motion-chart-legend';
    [
      { label: 'Rhythmusauffälligkeiten (%)', type: 'irregularity' },
      { label: 'Intervallstreuung (%)', type: 'variation' },
      { label: 'Samples', type: 'samples' },
      { label: 'Beschleunigungsdynamik', type: 'dynamics' },
      { label: 'Schwunghinweis ab 1,25×', type: 'threshold' }
    ].forEach(item => {
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

  function appendMotionRhythmChart(container, gaits) {
    const width = 360;
    const height = 210;
    const left = 44;
    const right = width - 38;
    const top = 24;
    const bottom = 158;
    const maxVariation = Math.max(...gaits.map(({ stats }) =>
      Number.isFinite(stats.averageIntervalVariationPercent)
        ? stats.averageIntervalVariationPercent
        : 0
    ));
    const percentMax = Math.max(100, Math.ceil(maxVariation / 20) * 20);
    const maxSamples = Math.max(1, ...gaits.map(({ stats }) => stats.windows));
    const sampleStep = Math.max(1, Math.ceil(maxSamples / 4));
    const sampleMax = Math.ceil(maxSamples / sampleStep) * sampleStep;
    const yForPercent = value => bottom - value / percentMax * (bottom - top);
    const yForSamples = value => bottom - value / sampleMax * (bottom - top);
    const xForIndex = index => gaits.length === 1
      ? (left + right) / 2
      : left + index * (right - left) / (gaits.length - 1);
    const svg = createSvgElement('svg', {
      class: 'motion-line-chart-svg',
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': 'Rhythmusauffälligkeiten als Balken, mittlere Intervallstreuung als Linie und Anzahl der Samples als Punkte'
    });
    const title = createSvgElement('title');
    title.textContent = 'Rhythmusauffälligkeiten, Intervallstreuung und Samples';
    svg.appendChild(title);

    [0, percentMax / 2, percentMax].forEach(value => {
      const y = yForPercent(value);
      svg.appendChild(createSvgElement('line', {
        x1: left,
        x2: right,
        y1: y,
        y2: y,
        class: 'motion-line-grid'
      }));
      appendText(svg, `${value.toFixed(0)}%`, {
        x: left - 6,
        y: y + 3,
        'text-anchor': 'end',
        class: 'motion-line-axis'
      });
    });

    for (let value = 0; value <= sampleMax; value += sampleStep) {
      appendText(svg, String(value), {
        x: right + 7,
        y: yForSamples(value) + 3,
        'text-anchor': 'start',
        class: 'motion-line-axis'
      });
    }

    const barWidth = Math.min(34, (right - left) / gaits.length * 0.42);
    const intervalPoints = [];
    gaits.forEach(({ label, stats }, index) => {
      const x = xForIndex(index);
      const irregularity = stats.irregularityPercent;
      if (Number.isFinite(irregularity)) {
        const y = yForPercent(irregularity);
        const bar = createSvgElement('rect', {
          x: x - barWidth / 2,
          y,
          width: barWidth,
          height: Math.max(0, bottom - y),
          class: 'motion-rhythm-bar'
        });
        const barTitle = createSvgElement('title');
        barTitle.textContent = `${label}: ${irregularity.toFixed(1)}% rhythmusauffällige Samples`;
        bar.appendChild(barTitle);
        svg.appendChild(bar);
        appendText(svg, `${irregularity.toFixed(1)}%`, {
          x,
          y: y - 5,
          'text-anchor': 'middle',
          class: 'motion-line-value'
        });
      }

      if (Number.isFinite(stats.averageIntervalVariationPercent)) {
        intervalPoints.push({
          x,
          y: yForPercent(stats.averageIntervalVariationPercent),
          label,
          value: stats.averageIntervalVariationPercent
        });
      }

      const sampleY = yForSamples(stats.windows);
      const samplePoint = createSvgElement('circle', {
        cx: x,
        cy: sampleY,
        r: 4,
        class: 'motion-samples-point'
      });
      const sampleTitle = createSvgElement('title');
      sampleTitle.textContent = `${label}: ${stats.windows} Samples`;
      samplePoint.appendChild(sampleTitle);
      svg.appendChild(samplePoint);
      appendText(svg, String(stats.windows), {
        x,
        y: sampleY - 8,
        'text-anchor': 'middle',
        class: 'motion-samples-value'
      });
      appendText(svg, label, {
        x,
        y: 181,
        'text-anchor': 'middle',
        class: 'motion-line-axis'
      });
    });

    if (intervalPoints.length > 1) {
      svg.appendChild(createSvgElement('polyline', {
        points: intervalPoints.map(point => `${point.x},${point.y}`).join(' '),
        class: 'motion-interval-series'
      }));
    }
    intervalPoints.forEach(point => {
      const marker = createSvgElement('circle', {
        cx: point.x,
        cy: point.y,
        r: 3.5,
        class: 'motion-interval-point'
      });
      const markerTitle = createSvgElement('title');
      markerTitle.textContent = `${point.label}: Intervallstreuung ${point.value.toFixed(1)}%`;
      marker.appendChild(markerTitle);
      svg.appendChild(marker);
      appendText(svg, `${point.value.toFixed(1)}%`, {
        x: point.x,
        y: point.y + 13,
        'text-anchor': 'middle',
        class: 'motion-interval-value'
      });
    });

    appendText(svg, 'Samples', {
      x: right + 7,
      y: 13,
      'text-anchor': 'start',
      class: 'motion-line-axis'
    });
    container.appendChild(svg);
  }

  function appendMotionLineChart(container, gaits, metric) {
    const width = 360;
    const height = 190;
    const left = 44;
    const right = width - 12;
    const top = 20;
    const bottom = 145;
    const yForValue = value => bottom - value / metric.max * (bottom - top);
    const xForIndex = index => gaits.length === 1
      ? (left + right) / 2
      : left + index * (right - left) / (gaits.length - 1);
    const section = document.createElement('section');
    section.className = 'motion-line-chart';
    const svg = createSvgElement('svg', {
      class: 'motion-line-chart-svg',
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': metric.title
    });
    const title = createSvgElement('title');
    title.textContent = metric.title;
    svg.appendChild(title);

    [0, metric.max / 2, metric.max].forEach(value => {
      const y = yForValue(value);
      svg.appendChild(createSvgElement('line', {
        x1: left,
        x2: right,
        y1: y,
        y2: y,
        class: 'motion-line-grid'
      }));
      appendText(svg, metric.format(value), {
        x: left - 6,
        y: y + 3,
        'text-anchor': 'end',
        class: 'motion-line-axis'
      });
    });

    if (Number.isFinite(metric.threshold)) {
      const thresholdY = yForValue(metric.threshold);
      svg.appendChild(createSvgElement('line', {
        x1: left,
        x2: right,
        y1: thresholdY,
        y2: thresholdY,
        class: 'motion-line-threshold'
      }));
    }

    const points = gaits
      .filter(({ stats }) => Number.isFinite(stats[metric.key]))
      .map(({ key, label, stats }, index) => ({
        key,
        label,
        value: stats[metric.key],
        windows: stats.windows,
        x: xForIndex(index)
      }));

    if (points.length > 1) {
      svg.appendChild(createSvgElement('polyline', {
        points: points.map(point => `${point.x},${yForValue(point.value)}`).join(' '),
        class: 'motion-line-series',
        stroke: metric.color
      }));
    }

    points.forEach(point => {
      const circle = createSvgElement('circle', {
        cx: point.x,
        cy: yForValue(point.value),
        r: 4,
        class: 'motion-line-point',
        fill: metric.color
      });
      const pointTitle = createSvgElement('title');
      pointTitle.textContent = `${point.label}: ${metric.format(point.value)} · ${point.windows} Fenster`;
      circle.appendChild(pointTitle);
      svg.appendChild(circle);
      appendText(svg, metric.format(point.value), {
        x: point.x,
        y: yForValue(point.value) - 8,
        'text-anchor': 'middle',
        class: 'motion-line-value'
      });
      appendText(svg, point.label, {
        x: point.x,
        y: 166,
        'text-anchor': 'middle',
        class: 'motion-line-axis'
      });
    });

    section.appendChild(svg);
    container.appendChild(section);
  }

  namespace.Charts = { renderRideHistoryChart, renderMotionAnalysisChart };
})(window);