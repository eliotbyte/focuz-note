import type { SvgIconComponent } from '@mui/icons-material'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import FavoriteBorderRoundedIcon from '@mui/icons-material/FavoriteBorderRounded'
import BookmarkRoundedIcon from '@mui/icons-material/BookmarkRounded'
import BookmarkBorderRoundedIcon from '@mui/icons-material/BookmarkBorderRounded'
import FlagRoundedIcon from '@mui/icons-material/FlagRounded'
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined'
import LabelRoundedIcon from '@mui/icons-material/LabelRounded'
import LabelOutlinedIcon from '@mui/icons-material/LabelOutlined'
import LightbulbRoundedIcon from '@mui/icons-material/LightbulbRounded'
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import WorkRoundedIcon from '@mui/icons-material/WorkRounded'
import WorkOutlineRoundedIcon from '@mui/icons-material/WorkOutlineRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded'
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined'
import PeopleRoundedIcon from '@mui/icons-material/PeopleRounded'
import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined'
import ChatBubbleRoundedIcon from '@mui/icons-material/ChatBubbleRounded'
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import MailRoundedIcon from '@mui/icons-material/MailRounded'
import MailOutlinedIcon from '@mui/icons-material/MailOutlined'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import ArchiveRoundedIcon from '@mui/icons-material/ArchiveRounded'
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined'
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded'
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined'
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded'
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined'
import MedicalServicesRoundedIcon from '@mui/icons-material/MedicalServicesRounded'
import MedicalServicesOutlinedIcon from '@mui/icons-material/MedicalServicesOutlined'
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded'
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined'
import SportsEsportsRoundedIcon from '@mui/icons-material/SportsEsportsRounded'
import SportsEsportsOutlinedIcon from '@mui/icons-material/SportsEsportsOutlined'
import LocalCafeRoundedIcon from '@mui/icons-material/LocalCafeRounded'
import LocalCafeOutlinedIcon from '@mui/icons-material/LocalCafeOutlined'
import ParkRoundedIcon from '@mui/icons-material/ParkRounded'
import ParkOutlinedIcon from '@mui/icons-material/ParkOutlined'
import type { FolderColor, FolderIconKey } from './folder-look'

/** Solid and outline form of each folder icon (see FOLDER_ICON_KEYS). */
export const FOLDER_ICONS: Record<FolderIconKey, { label: string; Solid: SvgIconComponent; Outline: SvgIconComponent }> = {
  folder: { label: 'Folder', Solid: FolderRoundedIcon, Outline: FolderOutlinedIcon },
  star: { label: 'Star', Solid: StarRoundedIcon, Outline: StarBorderRoundedIcon },
  heart: { label: 'Heart', Solid: FavoriteRoundedIcon, Outline: FavoriteBorderRoundedIcon },
  bookmark: { label: 'Bookmark', Solid: BookmarkRoundedIcon, Outline: BookmarkBorderRoundedIcon },
  flag: { label: 'Flag', Solid: FlagRoundedIcon, Outline: FlagOutlinedIcon },
  label: { label: 'Label', Solid: LabelRoundedIcon, Outline: LabelOutlinedIcon },
  idea: { label: 'Ideas', Solid: LightbulbRoundedIcon, Outline: LightbulbOutlinedIcon },
  done: { label: 'Done', Solid: CheckCircleRoundedIcon, Outline: CheckCircleOutlineRoundedIcon },
  work: { label: 'Work', Solid: WorkRoundedIcon, Outline: WorkOutlineRoundedIcon },
  home: { label: 'Home', Solid: HomeRoundedIcon, Outline: HomeOutlinedIcon },
  school: { label: 'Study', Solid: SchoolRoundedIcon, Outline: SchoolOutlinedIcon },
  people: { label: 'People', Solid: PeopleRoundedIcon, Outline: PeopleOutlinedIcon },
  chat: { label: 'Chats', Solid: ChatBubbleRoundedIcon, Outline: ChatBubbleOutlineRoundedIcon },
  mail: { label: 'Mail', Solid: MailRoundedIcon, Outline: MailOutlinedIcon },
  docs: { label: 'Documents', Solid: DescriptionRoundedIcon, Outline: DescriptionOutlinedIcon },
  archive: { label: 'Archive', Solid: ArchiveRoundedIcon, Outline: ArchiveOutlinedIcon },
  shopping: { label: 'Shopping', Solid: ShoppingBagRoundedIcon, Outline: ShoppingBagOutlinedIcon },
  money: { label: 'Money', Solid: SavingsRoundedIcon, Outline: SavingsOutlinedIcon },
  health: { label: 'Health', Solid: MedicalServicesRoundedIcon, Outline: MedicalServicesOutlinedIcon },
  place: { label: 'Places', Solid: PlaceRoundedIcon, Outline: PlaceOutlinedIcon },
  photo: { label: 'Photos', Solid: PhotoCameraRoundedIcon, Outline: PhotoCameraOutlinedIcon },
  games: { label: 'Games', Solid: SportsEsportsRoundedIcon, Outline: SportsEsportsOutlinedIcon },
  cafe: { label: 'Food', Solid: LocalCafeRoundedIcon, Outline: LocalCafeOutlinedIcon },
  nature: { label: 'Nature', Solid: ParkRoundedIcon, Outline: ParkOutlinedIcon },
}

export const FOLDER_COLOR_LABEL: Record<FolderColor, string> = {
  red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', teal: 'Teal',
  blue: 'Blue', indigo: 'Indigo', purple: 'Purple', pink: 'Pink', gray: 'Gray',
}
