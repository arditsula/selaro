export default function Footer() {
  return (
    <footer className="py-12 border-t border-[#E5E7EB] bg-[#F9FAFB]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-center gap-2 mb-3">
          <div className="w-8 h-1 bg-[#A7F3D0] rounded-full" />
        </div>
        <p className="text-center text-[#9CA3AF] text-sm font-light">
          Built by Ardit · Powered by GPT-5, Twilio, Botpress
        </p>
      </div>
    </footer>
  );
}
