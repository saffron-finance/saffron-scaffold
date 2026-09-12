import styled from 'styled-components'

interface ChevronIconProps {
  size?: number
}

/**
 * Chevron/triangle icon pointing down. Use CSS transform to rotate for other directions.
 * Matches the sort icons used in tables.
 */
export function ChevronIcon({ size = 14 }: ChevronIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 26 26'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path d='M12.5119 15.327L6.88159 9.69666H18.1423L12.5119 15.327Z' fill='currentColor' />
    </svg>
  )
}

/**
 * Chevron/triangle icon pointing up.
 */
export function ChevronUpIcon({ size = 14 }: ChevronIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 26 26'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path d='M12.5119 10.673L6.88159 16.3033H18.1423L12.5119 10.673Z' fill='currentColor' />
    </svg>
  )
}

/**
 * Double chevron icon (up and down) for neutral sort state.
 */
export function ChevronUpDownIcon({ size = 14 }: ChevronIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 26 26'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M17.7246 9.9052L12.5114 4.69193L7.2981 9.9052H17.7246ZM17.7246 15.1185L12.5114 20.3317L7.2981 15.1185H17.7246Z'
        fill='currentColor'
      />
    </svg>
  )
}

/**
 * Horizontal swap arrows (Material "swap_horiz"). Used to toggle between two
 * states, e.g. flipping the price denomination on the create-vault form.
 */
export function SwapIcon({ size = 16 }: ChevronIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z'
        fill='currentColor'
      />
    </svg>
  )
}

/**
 * Checkmark. Marks a completed step in the create-vault wizard's stepper.
 */
export function CheckIcon({ size = 12 }: ChevronIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='3'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path d='M20 6 9 17l-5-5' />
    </svg>
  )
}

/**
 * Pencil outline. The affordance for re-opening an already-completed step from
 * its summary card in the create-vault wizard.
 */
export function PencilIcon({ size = 16 }: ChevronIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path d='M12 20h9' />
      <path d='M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z' />
    </svg>
  )
}

/**
 * Wallet outline. Marks any figure that comes from the connected wallet's
 * balance, so a wallet amount is never confused with a vault-side amount.
 */
export function WalletIcon({ size = 16 }: ChevronIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path d='M21 12V7H5a2 2 0 0 1 0-4h14v4' />
      <path d='M3 5v14a2 2 0 0 0 2 2h16v-5' />
      <path d='M18 12a2 2 0 0 0 0 4h4v-4Z' />
    </svg>
  )
}

/**
 * A balance quoted inline in a sentence, tagged with the wallet icon. Use this
 * wherever copy names the connected wallet's holdings so every such figure is
 * marked the same way.
 */
export function WalletAmount({
  children,
  size = 13,
}: {
  children: React.ReactNode
  size?: number
}) {
  return (
    <WalletAmountWrapper>
      <WalletIcon size={size} />
      {children}
    </WalletAmountWrapper>
  )
}

const WalletAmountWrapper = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
`
