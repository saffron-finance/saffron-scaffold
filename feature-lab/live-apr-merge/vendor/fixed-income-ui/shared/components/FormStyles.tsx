import styled, { css } from 'styled-components'

import { Button } from './buttons/Button'
import { Card } from './card/Card'
import { MARBLE_WASH } from '../styles'

export const FormPageContainer = styled.div<{ $maxWidth?: string }>`
  width: 100%;
  max-width: ${(props) => props.$maxWidth || '650px'};
  margin: 0 auto;
  /* No top padding: the navbar's bottom gutter is the nav->content gap on every
     page (the Body wrapper adds none), so form pages sit the same distance below
     the nav as the rest of the app. */
  display: flex;
  flex-direction: column;
  gap: 30px;
`

export const FormContainer = styled(Card)<{ $minHeight?: string }>`
  position: relative;
  min-height: ${(props) => props.$minHeight || 'auto'};
  padding: 19px;
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 24px;
  /* Red focal glow + faint marble wash — the design's form surface, matching the
     create-vault form. Layered as a background (no overflow: hidden) so any
     dropdowns/tooltips inside aren't clipped. */
  background: ${({ theme }) => theme.colors.effects.glowRed},
    ${({ theme }) => theme.colors.background.card};
  ${MARBLE_WASH}
`

export const FormPageHeader = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  /* No extra top padding — the container's 19px already sits above the title, so
     the top gap matches the left/right padding. */
`

export const FormPageTitle = styled.h1`
  font-weight: 600;
  font-size: 24px;
  color: ${(props) => props.theme.colors.text.primary};
  text-align: center;
  margin: 0;
`

export const FormPageDescription = styled.p`
  color: ${(props) => props.theme.colors.text.secondary};
  font-size: 14px;
  text-align: center;
  line-height: 1.6;
  margin: 0;
  margin-top: -10px;
  max-width: 475px;
  align-self: center;
`

export const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 20px;
`

export const FormFieldGroup = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

export const FormLabel = styled.label`
  font-weight: 500;
  font-size: 14px;
  color: ${(props) => props.theme.colors.text.secondary};
`

/**
 * The visual contract for a form field, in ONE place.
 *
 * Shared by FormInput and by UsdInput, which used to carry the generic
 * `InputStyles` instead and so rendered narrower (max-width: 339px), shorter
 * (45px) and — the part that actually misled people — with its placeholder in
 * `text.primary`, making a hint indistinguishable from a typed value.
 */
export const FORM_FIELD_STYLES = css`
  width: 100%;
  height: 48px;
  padding: 0 16px;
  box-sizing: border-box;
  font-size: 14px;
  font-family: inherit;
  color: ${(props) => props.theme.colors.text.primary};
  background-color: var(--surface-input);
  border: 1px solid ${(props) => props.theme.colors.border.base};
  border-radius: var(--radius-md);
  transition: border-color 0.2s ease;

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.colors.accent.gold};
  }

  /* Dim on purpose: a placeholder is an example, not a value. */
  &::placeholder {
    color: ${(props) => props.theme.colors.text.tertiary};
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`

export const FormInput = styled.input<{ $hasError?: boolean }>`
  ${FORM_FIELD_STYLES}

  ${(props) =>
    props.$hasError &&
    css`
      border-color: ${props.theme.colors.semantic.error};

      &:focus {
        border-color: ${props.theme.colors.semantic.error};
      }
    `}
`

export const FormSelect = styled.select<{ $hasError?: boolean }>`
  width: 100%;
  height: 48px;
  /* extra right padding leaves room for the custom chevron */
  padding: 0 40px 0 16px;
  font-size: 14px;
  font-family: inherit;
  color: ${(props) => props.theme.colors.text.primary};
  /* drop the native arrow (which sits flush to the right edge) and draw our
     own chevron inset 16px, matching the left text inset */
  appearance: none;
  -webkit-appearance: none;
  background-color: var(--surface-input);
  background-image: url("data:image/svg+xml;utf8,<svg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M9 1L5 5L1 1' stroke='${(
    props
  ) => props.theme.colors.text.secondary.replace('#', '%23')}' stroke-width='1'/></svg>");
  background-repeat: no-repeat;
  background-position: right 16px center;
  border: 1px solid
    ${(props) =>
      props.$hasError ? props.theme.colors.semantic.error : props.theme.colors.border.base};
  border-radius: var(--radius-md);
  transition: border-color 0.2s ease;
  cursor: pointer;

  option {
    color: ${(props) => props.theme.colors.text.primary};
    background-color: var(--surface-input);
  }

  &:focus {
    outline: none;
    border-color: ${(props) =>
      props.$hasError ? props.theme.colors.semantic.error : props.theme.colors.accent.gold};
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`

export const FormFieldError = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.colors.semantic.error};
`

/**
 * Shared checkbox row: a <label> wrapping the box + its text so clicking the
 * text toggles the box. Use with FormCheckbox + FormCheckboxText. Centralized
 * here so every form's checkbox reads the same (matching the filter modal's
 * native accent-color checkbox).
 */
export const FormCheckboxRow = styled.label`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
`

export const FormCheckbox = styled.input`
  width: 18px;
  height: 18px;
  /* Nudge down so the box aligns with the first line of multi-line label text. */
  margin-top: 1px;
  flex-shrink: 0;
  cursor: pointer;
  accent-color: ${(props) => props.theme.colors.primary.base};
`

export const FormCheckboxText = styled.span`
  font-size: 14px;
  line-height: 1.4;
  color: ${(props) => props.theme.colors.text.primary};
`

export const FormButtonSection = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding-top: 0;
`

export const FormSubmitButton = styled(Button)`
  text-transform: uppercase;
  min-width: 180px;
  width: 100%;
`
