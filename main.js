(function () {
    const template = document.createElement("template");
    template.innerHTML = `
    <style>
      :host {
        width: 100%;
        height: 100%;
        display: block;
        color: var(--sapTextColor, #32363a);
        font-family: "72", "72full", Arial, sans-serif;
      }

      :host, :host * {
        box-sizing: border-box;
      }

      #root {
        width: 100%;
        height: 100%;
        position: relative;
      }

      #chart {
        width: 100%;
        height: 100%;
      }

      #noData {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 0.875rem;
        color: #999;
        display: none;
      }
    </style>

    <div id="root">
      <div id="chart"></div>
      <div id="noData">No Data Available</div>
    </div>
  `;

    class EchartsBulletSAP extends HTMLElement {
        constructor() {
            super();
            this._shadowRoot = this.attachShadow({ mode: "open" });
            this._shadowRoot.appendChild(template.content.cloneNode(true));

            this._chartContainer = this._shadowRoot.getElementById("chart");
            this._noDataEl = this._shadowRoot.getElementById("noData");

            this._chart = null;
            this._data = [];

            this._dimensionKey = null;
            this._actualKey = null;
            this._targetKey = null;

            this._props = {
                titleText: "",
                titleColor: "#000000",
                titleFontSize: 14,
                titleAlign: "center",
                orientation: "horizontal",
                actualColor: "#5470c6",
                targetColor: "#ee6666",
                rangePoorColor: "#d9534f",
                rangeSatisfactoryColor: "#f0ad4e",
                rangeGoodColor: "#5cb85c",
                rangeOpacity: 0.3,
                barThickness: 24,
                rangeBandScale: 1,
                targetLineWidth: 2,
                targetMarkerShape: "rect",

            };
        }

        _getScriptPromisify(src) {
            return new Promise((resolve, reject) => {
                try {
                    $.getScript(src)
                        .done(resolve)
                        .fail(() => reject(new Error('Failed to load script: ' + src)))
                } catch (e) {
                    reject(e)
                }
            })
        }

        _parseMetadata(metadata) {
            const { dimensions: dMap = {}, mainStructureMembers: mMap = {} } = metadata || {};
            return {
                dimensions: Object.keys(dMap || {}).map(k => ({ key: k, ...dMap[k] })),
                measures: Object.keys(mMap || {}).map(k => ({ key: k, ...mMap[k] }))
            };
        }

        async _loadECharts() {
            try {
                await this._getScriptPromisify(
                    'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js'
                )
            } catch (e) {
                throw new Error('Failed to load ECharts from CDN')
            }
        }

        async connectedCallback() {
            try {
                if (!window.echarts) {
                    await this._loadECharts();
                }

                if (!window.echarts) {
                    throw new Error("ECharts library is not available after loading.");
                }

                this._chart = window.echarts.init(this._chartContainer);
                this.render();
            } catch (err) {
                console.error("[EchartsBulletSAP] Initialization failed:", err);

                if (this._chart) {
                    try { this._chart.dispose(); } catch (e) { }
                    this._chart = null;
                }

                this._noDataEl.textContent =
                    "Chart library could not be loaded. Please try again later.";
                this._noDataEl.style.display = "block";
            }
        }

        disconnectedCallback() {
            if (this._chart) {
                try { this._chart.dispose(); } catch (e) { }
                this._chart = null;
            }
        }

        onCustomWidgetAfterUpdate(changedProps) {
            if (changedProps) {
                Object.keys(this._props).forEach((k) => {
                    if (Object.prototype.hasOwnProperty.call(changedProps, k)) {
                        this._props[k] = changedProps[k];
                    }
                });
            }
            this.render();
        }

        onCustomWidgetResize() {
            this._chart?.resize();
        }

        render() {
            if (!this._chart) {
                this._noDataEl.style.display = "block";
                return;
            }

            const binding = this.dataBinding;

            if (!binding || binding.state !== "success") {
                this._data = [];
                this._drawChart();
                return;
            }

            const { data, metadata } = binding;
            const { dimensions, measures } = this._parseMetadata(metadata);

            const findMeasureKey = (name) =>
                measures.find(m => m.key.toLowerCase().includes(name))?.key;

            this._poorKey = findMeasureKey("poor");
            this._satisfactoryKey = findMeasureKey("satisfactory");
            this._goodKey = findMeasureKey("good");

            console.log("measures", measures);
            this._mainMeasure = measures[0];
            this._markerMeasure = measures[1] || null;
            console.log(this._mainMeasure, this._markerMeasure);

            this._rangeLabels = {
                poor: measures.find(m => m.key === this._poorKey)?.label || "Poor",
                satisfactory: measures.find(m => m.key === this._satisfactoryKey)?.label || "Satisfactory",
                good: measures.find(m => m.key === this._goodKey)?.label || "Good"
            };

            if (!measures.length) {
                this._data = [];
                this._drawChart();
                return;
            }

            this._dimensionKey = dimensions[0]?.key || null;
            this._actualKey = measures[0]?.key;
            this._targetKey = measures[1]?.key || null;

            this._data = data.map((row, idx) => {
                const labelCell = this._dimensionKey ? row[this._dimensionKey] : null;
                const label =
                    labelCell?.label ??
                    labelCell?.value ??
                    `Item ${idx + 1}`;

                const actual = Number(row[this._actualKey]?.raw ?? 0);
                const target = this._targetKey
                    ? Number(row[this._targetKey]?.raw ?? actual)
                    : actual;

                const poor = this._poorKey
                    ? Number(row[this._poorKey]?.raw ?? 0)
                    : null;

                const satisfactory = this._satisfactoryKey
                    ? Number(row[this._satisfactoryKey]?.raw ?? 0)
                    : null;

                const good = this._goodKey
                    ? Number(row[this._goodKey]?.raw ?? 0)
                    : null;

                return { label, actual, target, poor, satisfactory, good };
            });

            this._drawChart();
        }

        _drawChart() {
            const hasData = this._data.length > 0;
            this._noDataEl.style.display = hasData ? "none" : "block";

            if (!hasData) {
                this._chart.clear();
                return;
            }
            const showValueAxisLine = {
                show: true,
                lineStyle: {
                    color: "#6a6d70",
                    width: 1
                }
            };

            const hideAxisLine = {
                show: false
            };


            const p = this._props;
            const horizontal = p.orientation === "horizontal";

            const categories = this._data.map(d => d.label);
            const actualValues = this._data.map(d => d.actual);
            const targetValues = this._data.map(d => d.target);

            const maxVal = Math.max(
                ...this._data.flatMap(d => [d.actual, d.target, d.good ?? 0]),
                1
            );

            // --- Qualitative thresholds (cumulative segments)
            const poorEnds = this._data.map(d => d.poor ?? maxVal * 0.6);
            const satisfactoryEnds = this._data.map(d => d.satisfactory ?? maxVal * 0.85);
            const goodEnds = this._data.map(d => d.good ?? maxVal);

            const poorValues = poorEnds;
            const satisfactoryValues = satisfactoryEnds.map((v, i) => v - poorEnds[i]);
            const goodValues = goodEnds.map((v, i) => v - satisfactoryEnds[i]);

            const titleHeight = p.titleText ? p.titleFontSize + 16 : 0;

            const scale = Number(p.rangeBandScale) || 1;
            const baseThickness = p.barThickness;

            // Scaled widths
            const rangeBarWidth = baseThickness * scale;
            const actualBarWidth = baseThickness * Math.min(scale, 1) * 0.65;

            const option = {
                title: {
                    text: p.titleText,
                    left: p.titleAlign,
                    top: 16,
                    textStyle: {
                        fontSize: p.titleFontSize,
                        color: p.titleColor
                    }
                },

                // 🔑 TWO OVERLAYED GRIDS
                grid: [
                    {
                        top: 24 + titleHeight,
                        left: 20,
                        right: 24,
                        bottom: 40,
                        containLabel: true
                    },
                    {
                        top: 24 + titleHeight,
                        left: 20,
                        right: 24,
                        bottom: 40,
                        containLabel: true
                    }
                ],

                // 🔑 DUPLICATED AXES (SYNCED)
                xAxis: horizontal
                    ? [
                        {
                            type: "value",
                            max: maxVal * 1.1,
                            gridIndex: 0,
                            axisLine: showValueAxisLine,
                            axisTick: { show: true }
                        },
                        {
                            type: "value",
                            max: maxVal * 1.1,
                            gridIndex: 1,
                            axisLine: hideAxisLine,
                            axisTick: { show: false }
                        }
                    ]
                    : [
                        {
                            type: "category",
                            data: categories,
                            gridIndex: 0,
                            axisLine: showValueAxisLine,
                            axisTick: { show: true },
                            axisLabel: { rotate: 45 }
                        },
                        {
                            type: "category",
                            data: categories,
                            gridIndex: 1,
                            axisLine: hideAxisLine,
                            axisTick: { show: false },
                            axisLabel: { rotate: 45 }
                        }
                    ],


                yAxis: horizontal
                    ? [
                        {
                            type: "category",
                            data: categories,
                            gridIndex: 0,
                            axisLine: hideAxisLine,
                            axisTick: { show: false },
                            axisLabel: { rotate: 0 }
                        },
                        {
                            type: "category",
                            data: categories,
                            gridIndex: 1,
                            axisLine: hideAxisLine,
                            axisTick: { show: false },
                            axisLabel: { rotate: 0 }
                        }
                    ]
                    : [
                        {
                            type: "value",
                            max: maxVal * 1.1,
                            gridIndex: 0,
                            axisLine: showValueAxisLine,
                            axisTick: { show: true }
                        },
                        {
                            type: "value",
                            max: maxVal * 1.1,
                            gridIndex: 1,
                            axisLine: hideAxisLine,
                            axisTick: { show: false }
                        }
                    ],


                tooltip: {
                    trigger: "axis",
                    axisPointer: { type: "shadow" },
                    formatter: (params) => {
                        const allowed = [
                            this._mainMeasure.label,
                            this._markerMeasure?.label
                        ];

                        const filtered = params.filter(p =>
                            allowed.includes(p.seriesName)
                        );

                        if (!filtered.length) return "";

                        let html = `<b>${params[0].axisValue}</b><br/>`;

                        filtered.forEach(p => {
                            html += `
                                    <span style="
                                        display:inline-block;
                                        width:8px;
                                        height:8px;
                                        border-radius:50%;
                                        background:${p.color};
                                        margin-right:6px;">
                                    </span>
                                     ${p.seriesName}: <b>${p.value}</b><br/>
                                    `;
                        });

                        return html;
                    }
                },

                legend: {
                    bottom: 8,
                    data: [
                        this._mainMeasure.label,
                        this._markerMeasure?.label,
                        this._rangeLabels.poor,
                        this._rangeLabels.satisfactory,
                        this._rangeLabels.good,
                    ].filter(Boolean)
                },
                series: [
                    {
                        name: this._rangeLabels.poor,
                        type: "bar",
                        stack: "ranges",
                        data: poorValues,
                        barWidth: rangeBarWidth,
                        xAxisIndex: 0,
                        yAxisIndex: 0,
                        itemStyle: { color: p.rangePoorColor, opacity: p.rangeOpacity },
                        silent: true
                    },
                    {
                        name: this._rangeLabels.satisfactory,
                        type: "bar",
                        stack: "ranges",
                        data: satisfactoryValues,
                        barWidth: rangeBarWidth,
                        xAxisIndex: 0,
                        yAxisIndex: 0,
                        itemStyle: { color: p.rangeSatisfactoryColor, opacity: p.rangeOpacity },
                        silent: true
                    },
                    {
                        name: this._rangeLabels.good,
                        type: "bar",
                        stack: "ranges",
                        data: goodValues,
                        barWidth: rangeBarWidth,
                        xAxisIndex: 0,
                        yAxisIndex: 0,
                        itemStyle: { color: p.rangeGoodColor, opacity: p.rangeOpacity },
                        silent: true
                    },
                    {
                        name: this._mainMeasure.label,
                        type: "bar",
                        data: actualValues,
                        barWidth: actualBarWidth,
                        xAxisIndex: 1,
                        yAxisIndex: 1,
                        itemStyle: { color: p.actualColor },
                        z: 10
                    },
                    {
                        name: this._markerMeasure?.label,
                        type: "line",
                        data: targetValues,
                        xAxisIndex: 1,
                        yAxisIndex: 1,
                        symbol: p.targetMarkerShape,
                        symbolSize: horizontal
                            ? [p.targetLineWidth * 4, rangeBarWidth + 6]
                            : [rangeBarWidth + 6, p.targetLineWidth * 4],
                        lineStyle: { opacity: 0 },
                        itemStyle: { color: p.targetColor },
                        z: 20
                    }
                ].filter(s => s.name),
            };

            this._chart.setOption(option, true);
        }

    }

    customElements.define("com-sap-sample-echarts-bullet", EchartsBulletSAP);
})();