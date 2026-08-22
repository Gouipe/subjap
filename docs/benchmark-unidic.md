# Benchmark UniDic

Le benchmark reproductible minimal est volontairement synthétique tant que les
licences des sous-titres d’anime ne permettent pas de versionner un corpus réel.
Il couvre les familles prévues par le plan : pluriels, variantes d’écriture,
conjugaison, katakana et ponctuation.

```powershell
npm.cmd run benchmark:unidic -- benchmarks/unidic-corpus.synthetic.json > benchmark-unidic.json
```

La sortie JSON est stable et diffable. Elle conserve pour chaque token la
surface, la forme orthographique de base, le lexème UniDic, la lecture, le POS
et la conjugaison. Un corpus local de 300 à 500 phrases peut remplacer le
fichier synthétique sans modifier le script.

## Version et redistribution

- paquet : `lindera-wasm-web-unidic@2.0.0` ;
- licence du paquet : MIT (`node_modules/lindera-wasm-web-unidic/LICENSE`) ;
- dictionnaire : UniDic embarqué dans le WASM distribué par ce paquet ;
- binaire dans le build actuel : environ 46,9 Mo non compressés.

La décision qualitative ne doit pas être prise sur ce corpus de démonstration.
Le rapport d’annotation devra comparer Kuromoji et Sudachi hors navigateur sur
un corpus autorisé, puis compléter les mesures Chrome d’initialisation, de
première cue, du temps par phrase et de la mémoire.
