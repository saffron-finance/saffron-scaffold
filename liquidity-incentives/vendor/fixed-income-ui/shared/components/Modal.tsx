import { useEffect } from 'react'
import styled, { useTheme } from 'styled-components'
import ReactModal from 'react-modal'

import CloseIcon from '../assets/images/close-x.svg?react'
import { mediaQuery } from '../utils/mediaQuery'
import { CUSTOM_SCROLLBAR } from '../styles'

export interface ModalProps {
  isOpen: boolean
  onRequestClose: () => void
  shouldCloseOnOverlayClick?: boolean
  /** 'wide' fits table-heavy content (e.g. admin drill-downs); default fits forms. */
  size?: 'default' | 'wide'
  /** Optional per-dialog spacing; other shared modal defaults stay unchanged. */
  contentStyle?: React.CSSProperties
  /** Wallet selection must stay above the form that requested a connection. */
  layer?: 'dialog' | 'wallet'
}

const TRANSITION_MS = 200
let openModalCount = 0

interface Props extends ModalProps {
  children: React.ReactNode
}

export function Modal({
  isOpen,
  onRequestClose,
  children,
  shouldCloseOnOverlayClick = true,
  size = 'default',
  contentStyle,
  layer = 'dialog',
}: Props) {
  useEffect(() => {
    if (!isOpen) return

    openModalCount += 1
    document.body.dataset.modalOpen = 'true'

    return () => {
      openModalCount = Math.max(0, openModalCount - 1)
      if (openModalCount === 0) delete document.body.dataset.modalOpen
    }
  }, [isOpen])

  return (
    <ReactModal
      closeTimeoutMS={TRANSITION_MS + 17}
      isOpen={isOpen}
      onRequestClose={onRequestClose}
      shouldCloseOnOverlayClick={shouldCloseOnOverlayClick}
      className='_'
      overlayClassName='_'
      ariaHideApp={false}
      contentElement={(props, children) => (
        <ModalElement {...props} $size={size} style={{ ...props.style, ...contentStyle }}>
          {children}
        </ModalElement>
      )}
      overlayElement={(props, contentElement) => (
        <ModalOverlayElement {...props} transitionMs={TRANSITION_MS} $layer={layer}>
          {contentElement}
        </ModalOverlayElement>
      )}
    >
      {children}
    </ReactModal>
  )
}

const ModalElement = styled.div<{ $size: 'default' | 'wide' }>`
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);

  width: ${({ $size }) => ($size === 'wide' ? 'min(960px, 92vw)' : '520px')};
  height: fit-content;
  /* Cap height so a form taller than the viewport scrolls inside the modal
     instead of overflowing past the centered box (top/bottom clipped). The
     existing overflow: auto supplies the scrollbar once this cap is hit. */
  max-height: 90vh;
  background: ${(props) => props.theme.colors.background.base};
  color: ${(props) => props.theme.colors.text.primary};
  overflow: auto;
  border-radius: var(--radius-md);
  outline: none;
  border: 1px solid var(--line-strong);
  box-shadow: 0 4px 4px rgba(0, 0, 0, 0.25);
  padding: 30px;

  ${CUSTOM_SCROLLBAR}

  ${mediaQuery('small')} {
    width: 95%;
    max-width: ${({ $size }) => ($size === 'wide' ? 'none' : '450px')};
    padding: 20px;
  }
`

const ModalOverlayElement = styled.div<{ transitionMs: number; $layer: 'dialog' | 'wallet' }>`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: ${(props) => props.theme.colors.effects.overlay};
  /* Portal mount order can change when the underlying request form rerenders. */
  z-index: ${({ $layer }) => $layer === 'wallet' ? 20 : 10};
  transition: opacity ${(props) => props.transitionMs}ms ease-out;

  &.ReactModal__Overlay {
    opacity: 0;
  }

  &.ReactModal__Overlay--after-open {
    opacity: 1;
  }

  &.ReactModal__Overlay--before-close {
    opacity: 0;
  }
`

export const ModalTitle = styled.div`
  font-size: 18px;
  font-weight: 500;
  margin-bottom: 26px;

  ${mediaQuery('small')} {
    margin-bottom: 16px;
  }
`

export function ModalCloseIcon({ onRequestClose }: { onRequestClose: () => void }) {
  const theme = useTheme()
  return (
    <Close onClick={onRequestClose} data-test-id='modal-close'>
      <CloseIcon fill={theme.colors.icons} />
    </Close>
  )
}

const Close = styled.div`
  position: fixed;
  right: 1px;
  top: 2px;
  padding: 10px 15px;
  cursor: pointer;
`
