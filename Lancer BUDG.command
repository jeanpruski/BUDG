#!/bin/zsh
cd "${0:A:h}"
if ! command -v npm >/dev/null 2>&1; then
  print 'Node.js est nécessaire pour lancer BUDG. Installez Node.js puis relancez ce fichier.'
  read '?Appuyez sur Entrée pour fermer.'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  print 'Les dépendances manquent. Lancez npm install dans le dossier BUDG.'
  read '?Appuyez sur Entrée pour fermer.'
  exit 1
fi
npm start
if [[ $? -ne 0 ]]; then
  read '?Appuyez sur Entrée pour fermer.'
fi
