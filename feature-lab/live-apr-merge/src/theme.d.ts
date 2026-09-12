import 'styled-components'
import type { SaffronTheme } from './host/ui'

// Use the upstream theme contract for both imported and feature-local styles.
declare module 'styled-components' {
  export interface DefaultTheme extends SaffronTheme {}
}
