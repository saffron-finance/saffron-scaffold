export function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null
}

export function formatRgbString(r: number, g: number, b: number, opacity = 1) {
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

export function hexToRgbString(hex: string, opacity: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return ''
  return formatRgbString(rgb.r, rgb.g, rgb.b, opacity)
}
