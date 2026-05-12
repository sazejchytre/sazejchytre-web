import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils/cn'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        basic: 'border-transparent bg-brand-600 text-white',
        pro: 'border-transparent bg-purple-600 text-white',
        elite: 'border-transparent bg-gradient-to-r from-gold-600 to-gold-400 text-gray-900',
        won: 'border-transparent bg-green-600 text-white',
        lost: 'border-transparent bg-red-600 text-white',
        void: 'border-transparent bg-gray-600 text-white',
        pending: 'border-transparent bg-yellow-600 text-white',
        published: 'border-transparent bg-green-700 text-white',
        draft: 'border-transparent bg-gray-700 text-gray-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
