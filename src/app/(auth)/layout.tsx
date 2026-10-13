export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen overflow-y-auto bg-[#f7f6f3]">
      {children}
    </div>
  );
}
