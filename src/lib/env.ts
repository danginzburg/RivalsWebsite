import { z } from 'zod'

const envSchema = z.object({
  PUBLIC_SITE_NAME: z.string(),
})

export const env = envSchema.parse(import.meta.env)
