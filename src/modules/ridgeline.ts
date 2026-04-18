import { max, range } from 'd3-array'
import { axisBottom } from 'd3-axis'
import { scaleLinear } from 'd3-scale'
import { select, type Selection } from 'd3-selection'
import { area, curveBasis, line } from 'd3-shape'

export interface RidgelineSeries {
  key: string
  label: string
  color: string
  values: number[]
}

const ROW_H = 70
const OVERLAP = 0.3
const LEFT_PAD = 120
const BOTTOM_PAD = 30
const TOP_PAD = 10

function normalizeValues(values: any[], pointCount: number): number[] {
  var normalized = Array.isArray(values) ? values.slice(0, pointCount) : []
  while (normalized.length < pointCount) normalized.push(0)
  return normalized.map(function(value) {
    var parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  })
}

export class Ridgeline {
  private container: HTMLElement
  private instanceId: string
  private labels: string[] = []
  private svg!: Selection<SVGSVGElement, unknown, any, any>
  private rawSeriesList: RidgelineSeries[] = []
  private xScaleFn: any = null
  private tooltip: HTMLDivElement | null = null

  constructor(container: HTMLElement) {
    this.container = container
    this.instanceId = Math.random().toString(36).slice(2, 8)
  }

  setData(labels: string[], seriesList: RidgelineSeries[]) {
    var seriesCount = seriesList.length
    var totalHeight = ROW_H * seriesCount * (1 - OVERLAP) + ROW_H * OVERLAP + BOTTOM_PAD + 20
    var pointCount = seriesList.reduce(function(acc, series) {
      return Math.max(acc, Array.isArray(series.values) ? series.values.length : 0)
    }, labels.length)
    var width = Math.max(
      Math.floor(this.container.getBoundingClientRect().width || this.container.clientWidth || 0),
      LEFT_PAD + 180
    )
    var plotRight = width - 24
    var step = ROW_H * (1 - OVERLAP)
    var axisY = totalHeight - BOTTOM_PAD
    var resolvedLabels = range(pointCount).map(function(index) {
      return labels[index] || String(index + 1)
    })
    var xScale = scaleLinear()
      .domain([0, pointCount > 1 ? pointCount - 1 : 1])
      .range([LEFT_PAD, plotRight])

    this.container.innerHTML = ''
    this.container.style.background = '#0a0a12'
    this.container.style.borderRadius = '10px'
    this.container.style.overflow = 'hidden'

    var root = select(this.container)
    var svg = root
      .append('svg')
      .attr('width', width)
      .attr('height', totalHeight)
      .attr('viewBox', '0 0 ' + width + ' ' + totalHeight)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('display', 'block')
      .style('width', '100%')
      .style('height', totalHeight + 'px')

    this.labels = resolvedLabels
    this.svg = svg

    svg.append('rect')
      .attr('width', width)
      .attr('height', totalHeight)
      .attr('fill', '#0a0a12')

    var defs = svg.append('defs')

    seriesList.forEach(function(series, index) {
      var values = normalizeValues(series.values, pointCount)
      var peak = max(values) || 1
      var yOffset = TOP_PAD + index * step
      var baseline = yOffset + ROW_H
      var yScale = scaleLinear()
        .domain([0, peak])
        .range([baseline, yOffset + 8])
      var gradientId = 'ridgeline-gradient-' + index + '-' + this.instanceId
      var gradient = defs.append('linearGradient')
        .attr('id', gradientId)
        .attr('x1', '0%')
        .attr('x2', '0%')
        .attr('y1', '0%')
        .attr('y2', '100%')

      gradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', series.color)
        .attr('stop-opacity', 0.85)

      gradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', series.color)
        .attr('stop-opacity', 0.05)

      var areaPath = area<number>()
        .x(function(_value, valueIndex) { return xScale(valueIndex) })
        .y0(baseline)
        .y1(function(value) { return yScale(value) })
        .curve(curveBasis)

      var linePath = line<number>()
        .x(function(_value, valueIndex) { return xScale(valueIndex) })
        .y(function(value) { return yScale(value) })
        .curve(curveBasis)

      svg.append('path')
        .datum(values)
        .attr('d', areaPath as any)
        .attr('fill', 'url(#' + gradientId + ')')

      svg.append('path')
        .datum(values)
        .attr('d', linePath as any)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255,255,255,0.65)')
        .attr('stroke-width', 1)

      svg.append('text')
        .attr('x', LEFT_PAD - 14)
        .attr('y', yOffset + ROW_H / 2)
        .attr('fill', '#e2e8f0')
        .attr('font-size', 12)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .text(series.label)
    }, this)

    var axis = axisBottom(xScale)
      .tickValues(range(pointCount))
      .tickSizeOuter(0)
      .tickFormat(function(value) { return String(Number(value) + 1) } as any)

    var axisGroup = svg.append('g')
      .attr('transform', 'translate(0,' + axisY + ')')
      .call(axis as any)

    axisGroup.selectAll('path, line')
      .attr('stroke', '#334155')

    axisGroup.selectAll('text')
      .attr('fill', '#64748b')
      .style('font-size', '10px')

    if (this.tooltip) {
      this.tooltip.remove()
      this.tooltip = null
    }
    ;(this.svg.node() as any).__hoverBound = false
    this.rawSeriesList = seriesList
    this.xScaleFn = xScale
    this.bindHover()
  }

  private bindHover() {
    if ((this.svg.node() as any).__hoverBound) return
    ;(this.svg.node() as any).__hoverBound = true

    const overlay = this.svg.append('rect')
      .attr('class', 'ridge-overlay')
      .attr('x', 0).attr('y', 0)
      .attr('width', '100%').attr('height', '100%')
      .attr('fill', 'transparent')
      .style('pointer-events', 'all')

    const crosshair = this.svg.append('line')
      .attr('class', 'ridge-crosshair')
      .attr('stroke', 'rgba(255,255,255,0.35)')
      .attr('stroke-dasharray', '4 4')
      .attr('stroke-width', 1)
      .style('opacity', 0)
      .style('pointer-events', 'none')

    const dotsGroup = this.svg.append('g')
      .attr('class', 'ridge-dots')
      .style('opacity', 0)
      .style('pointer-events', 'none')

    this.rawSeriesList.forEach((s, i) => {
      dotsGroup.append('circle')
        .attr('class', `ridge-dot ridge-dot-${i}`)
        .attr('r', 3)
        .attr('fill', s.color)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
    })

    this.tooltip = document.createElement('div')
    this.tooltip.className = 'ridge-tooltip'
    this.tooltip.style.cssText = `
      position: absolute;
      pointer-events: none;
      background: rgba(15, 23, 42, 0.95);
      color: #e2e8f0;
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 12px;
      line-height: 1.6;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      z-index: 100;
      opacity: 0;
      transition: opacity 0.12s ease;
      white-space: nowrap;
    `
    this.container.style.position = 'relative'
    this.container.appendChild(this.tooltip)

    const self = this
    overlay.on('mousemove', function(event: MouseEvent) {
      const mx = event.offsetX
      const my = event.offsetY
      const T = self.labels.length
      if (!T) return

      let idx = 0
      if (self.xScaleFn && self.xScaleFn.invert) {
        idx = Math.max(0, Math.min(T - 1, Math.round(self.xScaleFn.invert(mx))))
      }
      const xAtIdx = self.xScaleFn(idx)

      const svgH = +(self.svg.attr('height') || 0)
      crosshair
        .attr('x1', xAtIdx).attr('x2', xAtIdx)
        .attr('y1', 0).attr('y2', svgH)
        .style('opacity', 1)

      self.rawSeriesList.forEach((s, i) => {
        const values = normalizeValues(s.values, T)
        const sMin = Math.min(...values, 0)
        const sMax = Math.max(...values, 1)
        const span = sMax - sMin || 1
        const yOffset = TOP_PAD + i * ROW_H * (1 - OVERLAP)
        const yv = yOffset + ROW_H - (((values[idx] ?? 0) - sMin) / span) * (ROW_H - 10)
        dotsGroup.select(`.ridge-dot-${i}`)
          .attr('cx', xAtIdx)
          .attr('cy', yv)
      })
      dotsGroup.style('opacity', 1)

      const lines = self.rawSeriesList.map(s => {
        const v = s.values[idx] ?? 0
        return `<div style="display:flex;align-items:center;gap:6px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.color}"></span>
          <span style="color:#94a3b8;flex:1">${s.label}</span>
          <span style="color:#f1f5f9;font-weight:600;font-variant-numeric:tabular-nums">${v}</span>
        </div>`
      }).join('')
      self.tooltip!.innerHTML = `<div style="color:#f1f5f9;font-weight:600;margin-bottom:6px">${self.labels[idx]}</div>${lines}`

      const ctnRect = self.container.getBoundingClientRect()
      const tipW = self.tooltip!.offsetWidth || 200
      let tipX = mx + 16
      const tipY = my + 10
      if (tipX + tipW > ctnRect.width - 16) {
        tipX = mx - tipW - 16
      }
      self.tooltip!.style.left = tipX + 'px'
      self.tooltip!.style.top = tipY + 'px'
      self.tooltip!.style.opacity = '1'
    })

    overlay.on('mouseleave', function() {
      crosshair.style('opacity', 0)
      dotsGroup.style('opacity', 0)
      if (self.tooltip) self.tooltip.style.opacity = '0'
    })
  }

  destroy() {
    if (this.tooltip) {
      this.tooltip.remove()
      this.tooltip = null
    }
    this.container.innerHTML = ''
    this.rawSeriesList = []
    this.labels = []
    this.xScaleFn = null
  }
}
