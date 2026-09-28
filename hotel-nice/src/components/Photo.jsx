import { useState } from 'react'
import { ImageIcon } from 'lucide-react'

/** Image avec repli élégant si le fichier n'est pas encore déposé. */
export default function Photo({ src, alt, className = '', label }) {
  const [erreur, setErreur] = useState(false)

  if (erreur || !src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-sable-200 via-sable-100 to-foret-50 text-sable-500 ${className}`}
      >
        <ImageIcon className="h-8 w-8" strokeWidth={1.5} aria-hidden />
        <span className="px-4 text-center text-xs font-medium tracking-wide uppercase">
          {label ?? 'Photo à venir'}
        </span>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setErreur(true)}
      className={`object-cover ${className}`}
    />
  )
}
