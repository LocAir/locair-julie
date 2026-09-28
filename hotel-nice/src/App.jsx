import Header from './components/Header'
import Hero from './components/Hero'
import Bento from './components/Bento'
import Audience from './components/Audience'
import ContactForm from './components/ContactForm'
import Faq from './components/Faq'
import Footer from './components/Footer'
import MobileCta from './components/MobileCta'
import WhatsAppFloat from './components/WhatsAppFloat'

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Bento />
        <Audience />
        <ContactForm />
        <Faq />
      </main>
      <Footer />
      <MobileCta />
      <WhatsAppFloat />
    </>
  )
}
