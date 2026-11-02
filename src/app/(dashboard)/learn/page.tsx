import { redirect } from 'next/navigation';

/** Assigned Tracks are listed on Home; `/learn` alone has no content. */
export default function LearnIndexPage() {
  redirect('/');
}
