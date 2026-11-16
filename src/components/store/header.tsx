import { Heart, ShoppingBag, ShieldCheck, User } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/ui/bits";
import { getCurrentCart, getViewer } from "@/lib/viewer";
import { listCategoryRecords } from "@/services/catalog";
import { MobileMenu } from "./mobile-menu";
import { SearchBox } from "./search-box";

export async function Header() {
  const [{ user }, cart, categories] = await Promise.all([getViewer(), getCurrentCart(), listCategoryRecords()]);
  const cats = categories.map((c) => ({ name: c.name, slug: c.slug }));
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur-md supports-[backdrop-filter]:bg-bg/75">
      <a href="#main" className="btn btn-gold btn-sm absolute top-2 left-2 z-50 -translate-y-20 focus:translate-y-0">
        Skip to content
      </a>
      <div className="container-x flex h-16 items-center gap-2 sm:gap-4">
        <MobileMenu categories={cats} signedIn={!!user} isStaff={!!user?.isStaff} />
        <Link href="/" aria-label="AUREX home" className="mr-auto shrink-0 lg:mr-2">
          <Logo />
        </Link>
        <SearchBox className="hidden max-w-xl flex-1 md:block lg:mx-4" />
        <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="Account">
          {user?.isStaff ? (
            <Link href="/admin" className="btn btn-ghost btn-sm hidden lg:inline-flex">
              <ShieldCheck className="size-4 text-gold" aria-hidden /> Admin
            </Link>
          ) : null}
          <Link href="/account/wishlist" className="btn btn-ghost btn-icon hidden sm:inline-flex" aria-label="Wishlist">
            <Heart className="size-5" />
          </Link>
          <Link href={user ? "/account" : "/login"} className="btn btn-ghost btn-icon sm:w-auto sm:px-3" aria-label={user ? "My account" : "Sign in"}>
            <User className="size-5" />
            <span className="hidden max-w-28 truncate text-sm font-medium sm:inline">{user ? user.name.split(" ")[0] : "Sign in"}</span>
          </Link>
          <Link href="/cart" className="btn btn-ghost btn-icon relative" aria-label={`Cart, ${cart.itemCount} item${cart.itemCount === 1 ? "" : "s"}`} data-testid="cart-link">
            <ShoppingBag className="size-5" />
            {cart.itemCount > 0 ? (
              <span data-testid="cart-count" className="absolute top-1 right-0.5 flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-gold px-1 text-[0.65rem] font-bold text-black tabular-nums">
                {cart.itemCount > 99 ? "99+" : cart.itemCount}
              </span>
            ) : null}
          </Link>
        </nav>
      </div>
      <div className="container-x pb-3 md:hidden">
        <SearchBox />
      </div>
      <nav className="hidden border-t border-line/70 lg:block" aria-label="Categories">
        <div className="container-x no-scrollbar flex h-11 items-center gap-6 overflow-x-auto text-[0.82rem] text-muted">
          <Link href="/products" className="shrink-0 font-medium text-ink hover:text-gold-bright">
            All products
          </Link>
          {cats.map((c) => (
            <Link key={c.slug} href={`/products?category=${c.slug}`} className="shrink-0 transition-colors hover:text-gold-bright">
              {c.name}
            </Link>
          ))}
          <span className="ml-auto flex shrink-0 gap-6">
            <Link href="/wholesale" className="text-gold hover:text-gold-bright">
              Wholesale
            </Link>
            <Link href="/track" className="hover:text-gold-bright">
              Track order
            </Link>
          </span>
        </div>
      </nav>
    </header>
  );
}
