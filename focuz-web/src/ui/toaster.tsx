import { Toaster } from 'sonner'
import { useThemeMode } from '../lib/theme'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded'
import WarningRoundedIcon from '@mui/icons-material/WarningRounded'
import InfoRoundedIcon from '@mui/icons-material/InfoRounded'

// Styled from the app's tokens (see .toast* in index.css) instead of Sonner's defaults.
export function AppToaster() {
  const themeMode = useThemeMode()
  return (
    <Toaster
      position="bottom-center"
      theme={themeMode}
      visibleToasts={3}
      gap={8}
      offset={20}
      mobileOffset={12}
      closeButton
      icons={{
        success: <CheckCircleRoundedIcon fontSize="inherit" />,
        error: <ErrorRoundedIcon fontSize="inherit" />,
        warning: <WarningRoundedIcon fontSize="inherit" />,
        info: <InfoRoundedIcon fontSize="inherit" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'toast',
          content: 'toast-content',
          title: 'toast-title',
          description: 'toast-description',
          icon: 'toast-icon',
          actionButton: 'toast-action',
          closeButton: 'toast-close',
          success: 'toast-success',
          error: 'toast-error',
          warning: 'toast-warning',
          info: 'toast-info',
        },
      }}
    />
  )
}
