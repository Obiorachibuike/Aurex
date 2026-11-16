export default function Loading() {
  return (
    <div className="container-x py-12" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-9 w-72" />
      <div className="skeleton mt-4 h-4 w-96 max-w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="skeleton h-40" /><div className="skeleton h-40" /><div className="skeleton h-40" />
      </div>
    </div>
  );
}
