import {
  Store,
  ShoppingCart,
  Package,
  ChefHat,
  Bike,
  Croissant,
  Wine,
  Coffee,
  Zap,
  Car,
  Navigation,
  TrainFront,
  Gamepad2,
  CircleParking,
  Shirt,
  Pill,
  UtensilsCrossed,
  Flame,
  Utensils,
  Dumbbell,
  Receipt,
  ArrowLeftRight,
  Sparkles,
  Tag,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'

const ICON_MAP: Record<string, React.FC<LucideProps>> = {
  store: Store,
  'shopping-cart': ShoppingCart,
  package: Package,
  'chef-hat': ChefHat,
  bike: Bike,
  croissant: Croissant,
  wine: Wine,
  coffee: Coffee,
  zap: Zap,
  car: Car,
  navigation: Navigation,
  'train-front': TrainFront,
  'gamepad-2': Gamepad2,
  'circle-parking': CircleParking,
  shirt: Shirt,
  pill: Pill,
  'utensils-crossed': UtensilsCrossed,
  flame: Flame,
  utensils: Utensils,
  dumbbell: Dumbbell,
  receipt: Receipt,
  'arrow-left-right': ArrowLeftRight,
  sparkles: Sparkles,
}

export function TagIcon({
  icon,
  size = 10,
  className,
  style,
}: {
  icon: string | null | undefined
  size?: number
  className?: string
  style?: React.CSSProperties
}) {
  if (!icon) return null
  const Icon = ICON_MAP[icon] ?? Tag
  return <Icon size={size} className={className} style={style} />
}
