import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/app/page-session";
import EgoApp from "@/components/ego/EgoApp";

export const dynamic = "force-dynamic";

export default async function EgoPage() {
  if (!(await hasValidSession())) redirect("/ego/login");
  return <EgoApp />;
}
