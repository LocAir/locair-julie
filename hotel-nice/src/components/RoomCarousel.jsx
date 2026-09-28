import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Photo from './Photo'

/** Carrousel léger des chambres : flèches, points, swipe et défilement auto. */
export default function RoomCarousel({ slides, badges }) {
  const [index, setIndex] = useState(0)
  const [pause, setPause] = useState(false)
  const [debutTouch, setDebutTouch] = useState(null)
  const total = slides.length

  const aller = useCallback((i) => setIndex((i + total) % total), [total])

  useEffect(() => {
    if (pause || total < 2) return
    const t = setInterval(() => setIndex((i) => (i + 1) % total), 5000)
    return () => clearInterval(t)
  }, [pause, total])

  return (
    <div
      className="group relative h-full min-h-80 overflow-hidden rounded-3xl"
      onMouseEnter={() => setPause(true)}
      onMouseLeave={() => setPause(false)}
      onTouchStart={(e) => setDebutTouch(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (debutTouch === null) return
        const dx = e.changedTouches[0].clientX - debutTouch
        if (Math.abs(dx) > 40) aller(index + (dx < 0 ? 1 : -1))
        setDebutTouch(null)
      }}
      role="region"
      aria-roledescription="carrousel"
      aria-label="Photos des chambres"
    >
      {slides.map((s, i) => (
        <div
          key={s.src}
          className={`absolute inset-0 transition-opacity duration-700 ${i === index ? 'opacity-100' : 'opacity-0'}`}
          aria-hidden={i !== index}
        >
          <Photo src={s.src} alt={s.alt} label={`Chambre — photo ${i + 1}`} className="h-full w-full" />
        </div>
      ))}

      {/* dégradé pour lisibilité */}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-nuit/85 via-nuit/10 to-transparent" />

      <div className="absolute inset-x-0 top-0 flex flex-wrap gap-2 p-5">
        {badges.map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 rounded-full bg-creme/90 px-3 py-1.5 text-xs font-medium text-nuit shadow-sm backdrop-blur"
          >
            <Icon className="h-3.5 w-3.5 text-foret" aria-hidden />
            {label}
          </span>
        ))}
      </div>

      <div className="absolute inset-x-0 bottom-0 p-6 text-creme">
        <p className="text-xs font-medium tracking-widest text-sable-300 uppercase">Les chambres</p>
        <p className="mt-1 font-display text-xl sm:text-2xl" aria-live="polite">
          {slides[index].legende}
        </p>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => aller(i)}
                aria-label={`Voir la photo ${i + 1}`}
                aria-current={i === index}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-creme' : 'w-1.5 bg-creme/50 hover:bg-creme/80'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => aller(index - 1)}
              aria-label="Photo précédente"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-creme/15 backdrop-blur transition hover:bg-creme/30"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => aller(index + 1)}
              aria-label="Photo suivante"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-creme/15 backdrop-blur transition hover:bg-creme/30"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
