import { max, range } from 'd3-array'
import { axisBottom } from 'd3-axis'
import { scaleLinear } from 'd3-scale'
import { select } from 'd3-selection'
import { area, curveBasis, line } from 'd3-shape'

export interface RidgelineSeries {
  key: string
  label: string
  color: string
  values: number[]
}

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

  constructor(container: HTMLElement) {
    this.container = container
    this.instanceId = Math.random().toString(36).slice(2, 8)
  }

  setData(labels: string[], seriesList: RidgelineSeries[]) {
    var ROW_H = 70
    var OVERLAP = 0.3
    var LEFT_PAD = 120
    var BOTTOM_PAD = 30
    var TOP_PAD = 10
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
  }
}
