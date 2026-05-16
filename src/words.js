export const CATEGORIES = [
  {
    id: "dieren", label: "🐾 Dieren",
    words: ["Olifant","Giraf","Dolfijn","Pinguin","Krokodil","Vlinder","Neushoorn","Octopus","Kangoeroe","Zeepaardje","Panda","Koala","Jaguar","Flamingo","Schildpad"]
  },
  {
    id: "eten", label: "🍕 Eten & Drinken",
    words: ["Pizza","Sushi","Stroopwafel","Avocado","Lasagne","Smoothie","Tiramisu","Poffertjes","Ramen","Hummus","Nachos","Croissant","Boba tea","Fondue","Stamppot"]
  },
  {
    id: "sport", label: "⚽ Sport",
    words: ["Voetbal","Basketbal","Tennis","Zwemmen","Skateboard","Boksen","Yoga","Wielrennen","Surfen","Klimmen","Badminton","Waterpolo","Snowboard","Freerunning","Darten"]
  },
  {
    id: "films", label: "🎬 Films & Series",
    words: ["Avatar","Titanic","Inception","The Office","Breaking Bad","Friends","Stranger Things","Matrix","Interstellar","Harry Potter","Game of Thrones","Squid Game","Peaky Blinders","La Casa de Papel","The Crown"]
  },
  {
    id: "steden", label: "🌍 Steden",
    words: ["Amsterdam","Tokyo","New York","Parijs","Dubai","Barcelona","Sydney","Rome","Bangkok","Londen","Istanbul","Los Angeles","Singapore","Kaapstad","Reykjavik"]
  },
  {
    id: "beroepen", label: "💼 Beroepen",
    words: ["Astronaut","Brandweerman","Chirurg","Dirigent","Etholoog","Forensisch rechercheur","Gids","Hacker","IJsbeeldhouder","Juwelier","Kapper","Loods","Makelaar","Neonatoloog","Ober"]
  },
  {
    id: "objecten", label: "🔧 Objecten",
    words: ["Telescoop","Accordeon","Kompas","Prisma","Metronoom","Scalpel","Periscoop","Boomerang","Graaf machine","Drankorgel","Luchtbel","Gyroscoop","Katapult","Magneet","Microscoop"]
  },
  {
    id: "natuur", label: "🌿 Natuur",
    words: ["Regenwoud","Gletsjer","Woestijn","Vulkaan","Koraalrif","Noorderlicht","Mangrove","Tyfoon","Geyser","Savanne","Fjord","Moeras","Tundra","Waterval","Atol"]
  },
];

export function randomWord(categoryId) {
  const cat = CATEGORIES.find(c => c.id === categoryId);
  if (!cat) return "Mysterie";
  return cat.words[Math.floor(Math.random() * cat.words.length)];
}
