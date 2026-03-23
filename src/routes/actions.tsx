import { createFileRoute } from '@tanstack/react-router'
import ActionsPage from '@/components/app/ActionsPage'

export const Route = createFileRoute('/actions')({ component: ActionsPage })
