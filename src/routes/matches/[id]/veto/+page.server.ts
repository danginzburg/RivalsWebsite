import { redirect } from '@sveltejs/kit'

export const load = async ({ params }: { params: { id: string } }) => {
  throw redirect(303, `/matches/${params.id}`)
}
