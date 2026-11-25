/* Espace client en anglais et en espagnol (25/11/2026).
   Le français reste le texte de base : ce fichier traduit, dans la page, les
   textes qui correspondent exactement à une clé ci-dessous (et quelques
   phrases à trous). Langue : ?lang=en|es (liens des SMS et emails), sinon la
   dernière choisie, sinon la langue du téléphone. */
(function () {
  var q = (new URLSearchParams(location.search).get('lang') || '').slice(0, 2).toLowerCase();
  var LG = '';
  if (q === 'en' || q === 'es' || q === 'fr') { LG = q; try { localStorage.setItem('client_lang', q); } catch (e) {} }
  if (!LG) { try { LG = localStorage.getItem('client_lang') || ''; } catch (e) {} }
  if (LG !== 'en' && LG !== 'es' && LG !== 'fr') { var n = (navigator.language || '').slice(0, 2).toLowerCase(); LG = n === 'en' || n === 'es' ? n : 'fr'; }
  window.CLIENT_LANG = LG;
  if (LG === 'fr') return;
  var K = LG === 'en' ? 0 : 1;
  var LOC = LG === 'en' ? 'en-GB' : 'es-ES';
  document.documentElement.lang = LG;

  // Dates : la page écrit en « fr-FR » ; on les affiche dans la langue du client.
  ['toLocaleDateString', 'toLocaleString', 'toLocaleTimeString'].forEach(function (m) {
    var orig = Date.prototype[m];
    Date.prototype[m] = function (loc, opt) { return orig.call(this, (!loc || /^fr/i.test(loc)) ? LOC : loc, opt); };
  });

  var T = {
    'Spécialiste du confort thermique': ['Thermal comfort specialist', 'Especialista en confort térmico'],
    'Loc\'Air, spécialiste du confort thermique': ['Loc\'Air, thermal comfort specialist', 'Loc\'Air, especialista en confort térmico'],
    'Aide': ['Help', 'Ayuda'],
    'Aide sur WhatsApp': ['Help on WhatsApp', 'Ayuda por WhatsApp'],
    'Ouvrir le menu': ['Open the menu', 'Abrir el menú'],
    'Menu': ['Menu', 'Menú'],
    'Fermer le menu': ['Close the menu', 'Cerrar el menú'],
    'Mon espace': ['My account', 'Mi espacio'],
    'Ma location': ['My rental', 'Mi alquiler'],
    'Prolonger': ['Extend', 'Ampliar'],
    'Livraison': ['Delivery', 'Entrega'],
    'Récupération': ['Collection', 'Recogida'],
    'Mes documents': ['My documents', 'Mis documentos'],
    'Assistance': ['Support', 'Asistencia'],
    'Retour au site': ['Back to the website', 'Volver a la web'],
    'Nouvelle réservation': ['New booking', 'Nueva reserva'],
    'Guides et conseils': ['Guides and tips', 'Guías y consejos'],
    'Espace ambassadeur': ['Ambassador area', 'Espacio embajador'],
    'Se déconnecter': ['Log out', 'Cerrar sesión'],
    'Réserver — livré dès demain': ['Book — delivered tomorrow', 'Reservar — entrega mañana'],
    'Votre location,': ['Your rental,', 'Tu alquiler,'],
    'en direct.': ['live.', 'en directo.'],
    'Le statut de votre livraison, en temps réel': ['Your delivery status, in real time', 'El estado de tu entrega, en tiempo real'],
    'Vos documents et vos factures': ['Your documents and invoices', 'Tus documentos y facturas'],
    'Prolonger en un clic, sans nous appeler': ['Extend in one click, no need to call', 'Amplía en un clic, sin llamarnos'],
    'Une question ? 06.63.79.87.56 — 7j/7 de 8h à 20h.': ['A question? +33 6 63 79 87 56 — 7 days a week, 8am–8pm.', '¿Una pregunta? +33 6 63 79 87 56 — 7 días a la semana, de 8 h a 20 h.'],
    'Suivez votre': ['Follow your', 'Sigue tu'],
    'location': ['rental', 'alquiler'],
    'Entrez votre numéro de téléphone — nous vous envoyons un code par SMS.': ['Enter your phone number — we’ll text you a code.', 'Escribe tu número de teléfono — te enviamos un código por SMS.'],
    'Numéro de téléphone': ['Phone number', 'Número de teléfono'],
    'Recevoir le code SMS': ['Get the code by text', 'Recibir el código por SMS'],
    'Connexion sécurisée · Vos données restent privées': ['Secure login · Your data stays private', 'Acceso seguro · Tus datos son privados'],
    'Code envoyé au': ['Code sent to', 'Código enviado al'],
    '. Valable 10 minutes.': ['. Valid for 10 minutes.', '. Válido 10 minutos.'],
    'Code reçu par SMS': ['Code received by text', 'Código recibido por SMS'],
    'Accéder à mon espace': ['Open my account', 'Entrar en mi espacio'],
    'Changer de numéro': ['Use another number', 'Cambiar de número'],
    'Bonjour': ['Hello', 'Hola'],
    'Bonjour,': ['Hello,', 'Hola,'],
    'Authentifiez-vous pour accéder à votre espace.': ['Sign in to open your account.', 'Identifícate para entrar en tu espacio.'],
    'Connexion par SMS →': ['Log in by text →', 'Entrar por SMS →'],
    'Document': ['Document', 'Documento'],
    'Télécharger': ['Download', 'Descargar'],
    'Fermer': ['Close', 'Cerrar'],
    'Aperçu du document': ['Document preview', 'Vista previa del documento'],
    'Réservation confirmée': ['Booking confirmed', 'Reserva confirmada'],
    'jours restants': ['days left', 'días restantes'],
    'jour restant': ['day left', 'día restante'],
    'Début': ['Start', 'Inicio'],
    'Fin': ['End', 'Fin'],
    'Climatiseur attribué à la livraison': ['Air conditioner assigned at delivery', 'Aire acondicionado asignado en la entrega'],
    'Total': ['Total', 'Total'],
    'Documents': ['Documents', 'Documentos'],
    'Bientôt': ['Soon', 'Pronto'],
    'Conciergerie': ['Concierge', 'Conserjería'],
    'Prolonger ma location': ['Extend my rental', 'Ampliar mi alquiler'],
    'Ajoutez des jours — paiement en ligne immédiat': ['Add days — instant online payment', 'Añade días — pago en línea inmediato'],
    'Chargement de votre dossier…': ['Loading your booking…', 'Cargando tu reserva…'],
    'Nouvelle date de fin': ['New end date', 'Nueva fecha de fin'],
    'J\'accepte les': ['I accept the', 'Acepto las'],
    'conditions générales de vente': ['terms and conditions', 'condiciones generales de venta'],
    'et la durée choisie.': ['and the chosen length.', 'y la duración elegida.'],
    'Payer': ['Pay', 'Pagar'],
    'Prolongation': ['Extension', 'Ampliación'],
    'Paiement sécurisé': ['Secure payment', 'Pago seguro'],
    'Chargement…': ['Loading…', 'Cargando…'],
    'Confirmer le paiement': ['Confirm payment', 'Confirmar el pago'],
    'SSL · Stripe · Aucun stockage des données bancaires': ['SSL · Stripe · Card details never stored', 'SSL · Stripe · No guardamos datos bancarios'],
    '← Modifier la date': ['← Change the date', '← Cambiar la fecha'],
    'confirmée !': ['confirmed!', '¡confirmada!'],
    'Retour à mon espace': ['Back to my account', 'Volver a mi espacio'],
    'Votre': ['Your', 'Tu'],
    'parcours': ['journey', 'recorrido'],
    'Voir les étapes': ['See the steps', 'Ver las etapas'],
    'Votre paiement est reçu.': ['Your payment has been received.', 'Hemos recibido tu pago.'],
    'Préparation': ['Preparation', 'Preparación'],
    'Livraison programmée': ['Delivery scheduled', 'Entrega programada'],
    'Installation': ['Installation', 'Instalación'],
    'Location en cours': ['Rental in progress', 'Alquiler en curso'],
    'Retour programmé': ['Return scheduled', 'Devolución programada'],
    'Location terminée': ['Rental finished', 'Alquiler terminado'],
    'Vos': ['Your', 'Tus'],
    'rendez-vous': ['appointments', 'citas'],
    'Mes': ['My', 'Mis'],
    'documents': ['documents', 'documentos'],
    'Contrat et factures': ['Contract and invoices', 'Contrato y facturas'],
    'Disponibles après la réservation': ['Available after booking', 'Disponibles tras la reserva'],
    'Vos documents apparaîtront ici dès qu\'ils seront disponibles.': ['Your documents will appear here as soon as they’re ready.', 'Tus documentos aparecerán aquí en cuanto estén listos.'],
    'Conciergerie Loc\'Air': ['Loc\'Air concierge', 'Conserjería Loc\'Air'],
    'Une question ?': ['A question?', '¿Una pregunta?'],
    'On s\'en occupe.': ['We’ll handle it.', 'Nos encargamos.'],
    '7 jours sur 7, de 8 h à 20 h.': ['7 days a week, 8am to 8pm.', '7 días a la semana, de 8 h a 20 h.'],
    'Signaler une panne': ['Report a fault', 'Avisar de una avería'],
    'Appeler': ['Call', 'Llamar'],
    'Raccourcis': ['Shortcuts', 'Accesos directos'],
    'Location active': ['Active rental', 'Alquiler activo'],
    'Profitez de la fraîcheur.': ['Enjoy the cool air.', 'Disfruta del fresco.'],
    'Intervention': ['Visit', 'Intervención'],
    'Autonome': ['Self-service', 'Autónomo'],
    'À faire avant le passage': ['Before our visit', 'Antes de nuestra visita'],
    'Laissez l\'accès disponible (digicode, gardien prévenu si besoin)': ['Make sure we can get in (door code, caretaker told if needed)', 'Deja el acceso libre (código de la puerta, conserje avisado si hace falta)'],
    'Éteignez le climatiseur avant le passage du technicien': ['Switch off the air conditioner before the technician arrives', 'Apaga el aire acondicionado antes de que llegue el técnico'],
    'Avancer la récupération': ['Bring the collection forward', 'Adelantar la recogida'],
    'Choisissez une nouvelle date et un créneau': ['Choose a new date and a time slot', 'Elige una nueva fecha y una franja horaria'],
    'Récupération prévue le': ['Collection planned on', 'Recogida prevista el'],
    'Nouvelle date souhaitée': ['New date wanted', 'Nueva fecha deseada'],
    'Créneau': ['Time slot', 'Franja horaria'],
    'Choisissez une date et un créneau': ['Choose a date and a time slot', 'Elige una fecha y una franja horaria'],
    'Merci ! Ce climatiseur est à vous.': ['Thank you! This air conditioner is yours.', '¡Gracias! Este aire acondicionado es tuyo.'],
    'Chargement du document…': ['Loading the document…', 'Cargando el documento…'],
    'Annulé — réessayez.': ['Cancelled — try again.', 'Cancelado — inténtalo de nuevo.'],
    'Appareil livré et prêt à l’emploi.': ['Unit delivered and ready to use.', 'Aparato entregado y listo para usar.'],
    'Avenant de prolongation': ['Extension addendum', 'Anexo de ampliación'],
    'Confirmé': ['Confirmed', 'Confirmado'],
    'Contrat de location': ['Rental contract', 'Contrato de alquiler'],
    'En préparation': ['Being prepared', 'En preparación'],
    'Erreur de connexion. Réessayez.': ['Connection error. Try again.', 'Error de conexión. Inténtalo de nuevo.'],
    'Erreur inattendue. Réessayez.': ['Unexpected error. Try again.', 'Error inesperado. Inténtalo de nuevo.'],
    'Erreur. Veuillez réessayer.': ['Error. Please try again.', 'Error. Inténtalo de nuevo.'],
    'Général': ['General', 'General'],
    'Installation réalisée': ['Installation done', 'Instalación realizada'],
    'Je le garde — payer maintenant': ['I’ll keep it — pay now', 'Me lo quedo — pagar ahora'],
    'Le livreur a votre créneau.': ['The driver has your time slot.', 'El repartidor tiene tu franja horaria.'],
    'Livrée': ['Delivered', 'Entregada'],
    'Merci de votre confiance.': ['Thank you for your trust.', 'Gracias por tu confianza.'],
    'Module paiement indisponible. Désactivez votre bloqueur de pub.': ['Payment form unavailable. Turn off your ad blocker.', 'Formulario de pago no disponible. Desactiva tu bloqueador de anuncios.'],
    'Non autorisé': ['Not allowed', 'No autorizado'],
    'Nous venons récupérer l’appareil.': ['We’re coming to collect the unit.', 'Vamos a recoger el aparato.'],
    'Paiement en attente de confirmation. Vérifiez votre email.': ['Payment awaiting confirmation. Check your email.', 'Pago pendiente de confirmación. Revisa tu email.'],
    'Paiement en attente': ['Payment pending', 'Pago pendiente'],
    'Paiement en cours…': ['Payment in progress…', 'Pago en curso…'],
    'Paiement indisponible — désactivez votre bloqueur de publicités et réessayez.': ['Payment unavailable — turn off your ad blocker and try again.', 'Pago no disponible — desactiva tu bloqueador de anuncios e inténtalo de nuevo.'],
    'Paiement refusé. Vérifiez vos informations bancaires ou essayez une autre carte. Si le problème persiste, appelez le 06.63.79.87.56.': ['Payment declined. Check your card details or try another card. If it keeps happening, call +33 6 63 79 87 56.', 'Pago rechazado. Revisa los datos de tu tarjeta o prueba otra. Si sigue pasando, llama al +33 6 63 79 87 56.'],
    'Paiement refusé.': ['Payment declined.', 'Pago rechazado.'],
    'Préparation de votre livraison': ['Preparing your delivery', 'Preparando tu entrega'],
    'Préparation…': ['Preparing…', 'Preparando…'],
    'Récupération programmée': ['Collection scheduled', 'Recogida programada'],
    'Réessayer le paiement': ['Retry the payment', 'Reintentar el pago'],
    'Réessayer': ['Try again', 'Reintentar'],
    'Terminée': ['Finished', 'Terminada'],
    'Veuillez choisir un créneau.': ['Please choose a time slot.', 'Elige una franja horaria.'],
    'Veuillez sélectionner une date.': ['Please choose a date.', 'Elige una fecha.'],
    'Votre appareil est vérifié et nettoyé.': ['Your unit is checked and cleaned.', 'Tu aparato está revisado y limpio.'],
    'Votre demande a été prise en compte. Vous allez recevoir un SMS de confirmation.': ['Your request has been received. You’ll get a confirmation text.', 'Hemos recibido tu solicitud. Recibirás un SMS de confirmación.'],
    'Vérification…': ['Checking…', 'Comprobando…'],
    'Guide utilisateur': ['User guide', 'Guía de uso'],
    'Tutoriel vidéo': ['Video tutorial', 'Vídeo tutorial'],
    'Ouvrir': ['Open', 'Abrir'],
    'Voir': ['See', 'Ver'],
    '7j/7': ['7/7', '7/7'],
    'CGV': ['Terms', 'CGV'],
    'Trop de tentatives — réessayez dans quelques minutes.': ['Too many attempts — try again in a few minutes.', 'Demasiados intentos — inténtalo en unos minutos.'],
    'Numéro de téléphone requis.': ['Phone number required.', 'Número de teléfono obligatorio.'],
    'Numéro de téléphone invalide.': ['Invalid phone number.', 'Número de teléfono no válido.'],
    'Erreur serveur — réessayez.': ['Server error — try again.', 'Error del servidor — inténtalo de nuevo.'],
    'Erreur serveur': ['Server error', 'Error del servidor'],
    'Code invalide ou expiré.': ['Invalid or expired code.', 'Código no válido o caducado.'],
    'Nous n\'avons pas retrouvé votre réservation. Merci de vérifier votre numéro de commande et votre adresse email.': ['We couldn’t find your booking. Please check your order number and email address.', 'No encontramos tu reserva. Revisa tu número de pedido y tu email.'],
    'Date invalide': ['Invalid date', 'Fecha no válida'],
    'Créneau invalide': ['Invalid time slot', 'Franja horaria no válida'],
    'Aucune récupération à venir trouvée': ['No upcoming collection found', 'No hay ninguna recogida prevista'],
    'Un transporteur est déjà en route — la modification de créneau n\'est plus possible.': ['A driver is already on the way — the time slot can no longer be changed.', 'Un repartidor ya está en camino — ya no se puede cambiar la franja.'],
    'La récupération doit être après la livraison.': ['Collection must be after delivery.', 'La recogida debe ser después de la entrega.'],
    'La nouvelle date doit être antérieure à la date actuelle de récupération': ['The new date must be before the current collection date', 'La nueva fecha debe ser anterior a la fecha de recogida actual'],
    'Un transporteur est déjà en route — la modification n\'est plus possible.': ['A driver is already on the way — it can no longer be changed.', 'Un repartidor ya está en camino — ya no se puede cambiar.']
  };
  var M = { 'Livraison': 1, 'Récupération': 1, 'Préparation': 1, 'Installation': 1, 'Location en cours': 1, 'Retour programmé': 1, 'Location terminée': 1, 'Livraison programmée': 1 };
  function tr(k) { var t = T[k]; return t ? t[K] : null; }
  var P = [
    [/^Dossier (.+)$/, function (m) { return (K ? 'Reserva ' : 'Booking ') + m[1]; }],
    [/^Étape (\d+) sur (\d+)$/, function (m) { return (K ? 'Etapa ' + m[1] + ' de ' : 'Step ' + m[1] + ' of ') + m[2]; }],
    [/^Suivant : (.+)$/, function (m) { return (K ? 'Siguiente: ' : 'Next: ') + (M[m[1]] && tr(m[1]) || m[1]); }],
    [/^(\d+) % de la location écoulés$/, function (m) { return K ? m[1] + ' % del alquiler transcurrido' : m[1] + '% of the rental done'; }],
    [/^\+(\d+) jours?$/, function (m) { return '+' + m[1] + (K ? (m[1] > 1 ? ' días' : ' día') : (m[1] > 1 ? ' days' : ' day')); }],
    [/^Livrée · (.+)$/, function (m) { return (K ? 'Entregada · ' : 'Delivered · ') + m[1]; }],
    [/^Récupéré · (.+)$/, function (m) { return (K ? 'Recogido · ' : 'Collected · ') + m[1]; }],
    [/^(\d+) jours?$/, function (m) { return m[1] + (K ? (m[1] > 1 ? ' días' : ' día') : (m[1] > 1 ? ' days' : ' day')); }]
  ];
  function traduire(v) {
    var k = v.replace(/\s+/g, ' ').trim();
    if (!k) return null;
    var t = tr(k);
    if (t == null) for (var i = 0; i < P.length; i++) { var m = P[i][0].exec(k); if (m) { t = P[i][1](m); break; } }
    if (t == null) return null;
    return v.replace(/\S[\s\S]*\S|\S/, t);
  }
  var ATTR = ['placeholder', 'aria-label', 'title', 'alt'];
  function passer(root) {
    if (!root) return;
    if (root.nodeType === 3) { var r = traduire(root.nodeValue); if (r != null && r !== root.nodeValue) root.nodeValue = r; return; }
    if (root.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(root.tagName)) return;
    ATTR.forEach(function (a) { var v = root.getAttribute && root.getAttribute(a); if (v) { var r = traduire(v); if (r != null && r !== v) root.setAttribute(a, r); } });
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    var n; while ((n = w.nextNode())) {
      if (n.nodeType === 3) { if (n.parentElement && /^(SCRIPT|STYLE)$/.test(n.parentElement.tagName)) continue; var r2 = traduire(n.nodeValue); if (r2 != null && r2 !== n.nodeValue) n.nodeValue = r2; }
      else ATTR.forEach(function (a) { var v = n.getAttribute(a); if (v) { var r3 = traduire(v); if (r3 != null && r3 !== v) n.setAttribute(a, r3); } });
    }
  }
  function demarrer() {
    document.title = LG === 'en' ? 'My account — Loc’Air' : 'Mi espacio — Loc’Air';
    passer(document.body);
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        if (m.type === 'characterData') passer(m.target);
        else if (m.type === 'attributes') passer(m.target);
        else m.addedNodes.forEach(passer);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTR });
  }
  if (document.body) demarrer(); else document.addEventListener('DOMContentLoaded', demarrer);
})();
