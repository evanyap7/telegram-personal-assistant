import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/app/page-session";
import EgoApp from "@/components/ego/EgoApp";
import InstallPrompt from "@/components/ego/InstallPrompt";
import RegisterSW from "@/components/ego/RegisterSW";

export const dynamic = "force-dynamic";

export default async function EgoPage() {
  if (!(await hasValidSession())) redirect("/ego/login");
  return (
    <>
      <EgoApp />
      <InstallPrompt />
      <RegisterSW />
    </>
  );
}
