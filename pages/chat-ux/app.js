import './chat-instance.js'

const testMode = new URLSearchParams(location.search).has('test')

if (testMode) {
  const wrapper = document.createElement('div')
  wrapper.className = 'split'

  const peerA = document.createElement('chat-instance')
  peerA.setAttribute('pseudo', 'ALICE')

  const peerB = document.createElement('chat-instance')
  peerB.setAttribute('pseudo', 'BOB')

  wrapper.append(peerA, peerB)
  document.body.appendChild(wrapper)

  // Cross-wire : quand A a son ID, B le reçoit (et vice-versa)
  peerA.addEventListener('id-ready', (e) => {
    peerB.remotePeerId = e.detail.id
  })

  peerB.addEventListener('id-ready', (e) => {
    peerA.remotePeerId = e.detail.id
  })

  // Pré-remplir uniquement pseudo et mot de passe
  // Le pseudo distant est injecté par le cross-wire (id-ready)
  const fill = (el, ref, val) => {
    const input = el.querySelector(`[data-ref="${ref}"]`)
    if (input) input.value = val
  }

  fill(peerA, 'password', 'test')
  fill(peerB, 'password', 'test')

} else {
  const instance = document.createElement('chat-instance')
  document.body.appendChild(instance)
}
