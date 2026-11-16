import { ChatWidget } from "@/components/store/chat-widget";
import { Footer } from "@/components/store/footer";
import { Header } from "@/components/store/header";

// Every storefront page shows the visitor's own cart and account state, so nothing here is statically cached.
export const dynamic = "force-dynamic";

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <Footer />
      <ChatWidget />
    </>
  );
}
