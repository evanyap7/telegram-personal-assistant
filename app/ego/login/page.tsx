import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/app/page-session";
import LoginForm from "@/components/ego/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await hasValidSession()) redirect("/ego");
  return <LoginForm />;
}
