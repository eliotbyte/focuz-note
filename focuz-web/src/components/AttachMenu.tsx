import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'

/**
 * One paperclip for everything a note can hold: a menu with "Picture" and "File". Used by the
 * composer (as a composer tool) and the full-screen editor (as a toolbar tool).
 */
export default function AttachMenu({
  onPickPicture,
  onPickFile,
  picturesDisabled,
  filesDisabled,
  triggerClassName,
  onCloseAutoFocus,
}: {
  onPickPicture: () => void
  onPickFile: () => void
  picturesDisabled?: boolean
  filesDisabled?: boolean
  triggerClassName: string
  /** The full-screen editor gives the focus back to the text instead of the button. */
  onCloseAutoFocus?: (e: Event) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={triggerClassName}
          aria-label="Attach"
          title="Attach a picture or a file"
          disabled={picturesDisabled && filesDisabled}
          // Keep the text's selection: the toolbar never takes the focus from the editor.
          onMouseDown={e => e.preventDefault()}
        >
          <AttachFileRoundedIcon fontSize="inherit" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="fse-menu" onCloseAutoFocus={onCloseAutoFocus}>
        <DropdownMenuItem className="fse-menu-item" disabled={picturesDisabled} onSelect={onPickPicture}>
          <ImageOutlinedIcon fontSize="inherit" className="icon-sm" />
          <span className="attach-item"><span>Picture</span><span className="attach-item-hint">{picturesDisabled ? 'Up to 10 per note' : 'JPG, PNG, WebP, HEIC'}</span></span>
        </DropdownMenuItem>
        <DropdownMenuItem className="fse-menu-item" disabled={filesDisabled} onSelect={onPickFile}>
          <DescriptionOutlinedIcon fontSize="inherit" className="icon-sm" />
          <span className="attach-item"><span>File</span><span className="attach-item-hint">{filesDisabled ? 'Up to 10 per note' : 'PDF, Word, Excel, PowerPoint, text, CSV'}</span></span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
