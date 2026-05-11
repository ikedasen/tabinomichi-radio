interface SearchHeaderProps {
  profile?: string
  setProfile?: (p: string) => void
  searchTag?: string
  setSearchTag?: (t: string) => void
  fetchingNew?: boolean
  onFetchNew?: () => void
  onSearch?: (e: React.FormEvent) => void
  onClearTag?: () => void
  onTerminate?: () => void
}

export default function SearchHeader(_props: SearchHeaderProps) {
  return (
    <header className="sticky top-0 z-40 bg-gradient-to-b from-amber-950 to-amber-950/0 backdrop-blur-sm">
      <div className="max-w-5xl mx-auto px-3 md:px-4 py-4 md:py-5">
        <h1 className="text-2xl md:text-3xl font-bold text-white inline-flex items-baseline gap-2.5 tracking-tight">
          <span
            aria-hidden
            className="inline-block w-5 h-5 md:w-6 md:h-6 bg-current text-amber-300"
            style={{
              WebkitMaskImage: "url(/icons/radio.svg)",
              maskImage: "url(/icons/radio.svg)",
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskPosition: 'center',
            }}
          />
          Tabinomichi Radio
        </h1>
      </div>
    </header>
  )
}
