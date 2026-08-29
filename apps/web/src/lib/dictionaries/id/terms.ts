// Ketentuan Layanan. Halaman statis; sumber kebenaran Bahasa. `sections` di-render
// berurutan sebagai heading + paragraf, sama seperti id/privacy.ts.
// Perbarui `effective` setiap kali isinya berubah secara material.
//
// KENAPA BERKAS INI ADA. Form pendaftaran sudah membuat setiap pelanggan menyetujui
// "Kebijakan Privasi dan Ketentuan Layanan Hydromart" (id/auth.ts:30-32) sejak hari
// pertama, sementara `/syarat-ketentuan` menjawab 404 dan tidak ada rutenya di
// apps/web/src/app. Jadi setiap orang yang pernah mendaftar menyetujui dokumen yang tidak
// pernah ditulis.
//
// Isinya disusun dari apa yang produk ini BENAR-BENAR lakukan, bukan dari templat: uang
// mengalir langsung ke depot tanpa gateway maupun escrow, deposit galon dikembalikan,
// pesanan adalah penawaran yang dikonfirmasi depot, harga ditentukan per depot, dan
// pengantaran dibuktikan dengan foto. Setiap pasal di bawah ini bisa ditelusuri ke kode
// yang menjalankannya.
//
// BELUM DITINJAU PENASIHAT HUKUM. Ini rancangan yang jujur dan spesifik, bukan pengganti
// pemeriksaan seorang ahli — terutama Pasal 8 (tanggung jawab) dan Pasal 10 (sengketa),
// yang batasannya tunduk pada UU No. 8 Tahun 1999 tentang Perlindungan Konsumen dan tidak
// boleh dipakai untuk mengesampingkan hak yang dijamin undang-undang. Mintakan review
// sebelum ada sengketa yang bergantung padanya.
export const terms = {
  title: 'Ketentuan Layanan',
  effective: 'Berlaku sejak 29 Agustus 2026',
  intro:
    'Ketentuan ini mengatur pemakaian aplikasi dan situs Hydromart. Dengan mendaftar atau memesan, kamu setuju pada isinya. Bacalah bersama Kebijakan Privasi kami, yang menjelaskan data pribadi apa yang kami olah dan atas dasar apa.',
  sections: [
    {
      heading: '1. Siapa kami dan apa yang kami lakukan',
      body: 'Hydromart adalah platform yang menghubungkanmu dengan depot air minum di sekitarmu. Depot itulah yang menyiapkan, menjual, dan mengantar air kepadamu — sebagian dimiliki Hydromart, sebagian dimiliki mitra waralaba. Kami menyediakan aplikasinya, memproses pesananmu, dan menetapkan standar yang harus dipenuhi depot. Kami bukan pihak yang memproduksi airnya.',
    },
    {
      heading: '2. Akun',
      body: 'Akun dibuat dengan nomor telepon dan diverifikasi lewat kode OTP. Satu nomor untuk satu akun. Kode OTP adalah kunci akunmu: jangan berikan kepada siapa pun, termasuk kepada orang yang mengaku dari Hydromart — kami tidak pernah meminta OTP lewat telepon, chat, atau pesan. Kamu bertanggung jawab atas aktivitas yang terjadi dari akunmu, dan wajib memberi tahu kami bila nomormu berpindah tangan. Kamu bisa menghapus akun kapan saja lewat halaman Hapus Akun.',
    },
    {
      heading: '3. Memesan',
      body: 'Pesananmu adalah penawaran untuk membeli, bukan transaksi yang langsung jadi. Depot yang melayani wilayahmu menerima atau menolaknya, dan pesanan baru mengikat setelah depot mengonfirmasi. Depot boleh menolak — misalnya stok habis, alamatmu di luar radius layanan, atau jam operasional sudah tutup — dan bila itu terjadi kamu tidak dikenai biaya apa pun.',
    },
    {
      heading: '4. Harga',
      body: 'Harga ditentukan oleh depot yang akan melayanimu, jadi produk yang sama bisa berbeda harga di depot yang berbeda. Harga yang berlaku adalah yang ditampilkan di layar pembayaran saat kamu memesan, sudah termasuk ongkos kirim dan potongan yang berlaku. Kami menampilkan harga dalam rupiah penuh. Bila terjadi kekeliruan harga yang nyata dan seharusnya kamu sadari — misalnya galon seharga seratus rupiah — kami boleh membatalkan pesanan itu dan mengembalikan uangmu.',
    },
    {
      heading: '5. Pembayaran',
      body: 'Pembayaran diterima langsung oleh depot, bukan oleh Hydromart. Kami tidak menahan uangmu, tidak menjadi perantara pembayaran, dan tidak menyimpan data kartu — kami hanya mencatat bahwa pembayaran terjadi. Cara bayar yang tersedia berbeda per depot: tunai saat barang diterima selalu bisa, sedangkan transfer bank dan QRIS hanya muncul bila depot itu sudah mendaftarkan tujuannya. Untuk pembayaran tunai, kurir akan mencatat jumlah yang kamu serahkan dan kembaliannya.',
    },
    {
      heading: '6. Deposit galon',
      body: 'Untuk galon yang kamu pinjam, ada deposit yang dibayar di muka dan dikembalikan saat galonnya kamu kembalikan dalam keadaan utuh. Deposit bukan biaya sewa dan tidak berkurang karena lamanya pemakaian. Galon yang pecah, retak, atau hilang tidak mendapat pengembalian deposit. Nilai depositnya ditampilkan sebelum kamu membayar.',
    },
    {
      heading: '7. Pengantaran',
      body: 'Jendela waktu antar adalah perkiraan, bukan janji jam pasti — lalu lintas, cuaca, dan antrean depot memengaruhinya. Pastikan alamat dan patokanmu benar; alamat yang keliru adalah sebab paling umum pengantaran gagal. Kurir mencatat serah terima dengan foto, dan boleh meminta tanda tangan penerima. Bila tidak ada orang di alamat itu, kurir akan menghubungimu dan pengantaran bisa dijadwalkan ulang.',
    },
    {
      heading: '8. Membatalkan, dan bila ada yang salah',
      body: 'Kamu bisa membatalkan sebelum depot mulai menyiapkan pesanan; setelah itu pembatalan bergantung pada persetujuan depot. Bila air atau galon yang kamu terima bermasalah — segelnya rusak, isinya keruh, jumlahnya kurang — laporkan pada hari yang sama lewat aplikasi, sertakan foto bila ada. Depot akan mengganti atau mengembalikan uangmu. Untuk pesanan yang sudah dibayar dan dibatalkan, uangmu dikembalikan oleh depot melalui jalur yang sama dengan cara kamu membayar.',
    },
    {
      heading: '9. Poin, tingkat keanggotaan, voucher, dan referal',
      body: 'Poin, tingkat keanggotaan, voucher, dan hadiah referal adalah program apresiasi, bukan uang. Semuanya tidak dapat diuangkan, dipindahtangankan, atau diperjualbelikan. Kami dapat mengubah tarif perolehan, ambang tingkat, besaran potongan, dan masa berlakunya, dan akan memberi tahu lewat aplikasi bila perubahannya material. Poin atau hadiah yang diperoleh dari pesanan yang kemudian dibatalkan akan ditarik kembali. Poin yang diperoleh dari cara yang tidak wajar — pesanan palsu, akun ganda, atau menyalahgunakan program referal — dapat kami hapus beserta akunnya.',
    },
    {
      heading: '10. Langganan',
      body: 'Langganan menjadwalkan pesanan berulang untukmu secara otomatis. Harga yang berlaku tetap harga pada saat setiap pesanan dibuat, bukan harga saat kamu berlangganan. Kamu bisa melewati satu jadwal, menjeda, atau menghentikannya kapan saja lewat aplikasi, dan penghentian berlaku untuk pesanan yang belum dibuat.',
    },
    {
      heading: '11. Agen dan mitra',
      body: 'Bila kamu terdaftar sebagai agen atau mitra waralaba, hubungan itu diatur perjanjian tersendiri yang kamu tanda tangani, dan perjanjian itu yang berlaku bila isinya berbeda dari ketentuan ini. Harga khusus agen menggantikan potongan keanggotaan dan voucher, tidak ditumpuk dengannya.',
    },
    {
      heading: '12. Yang tidak boleh dilakukan',
      body: 'Jangan memesan tanpa niat membeli, membuat akun dengan nomor orang lain, memakai layanan ini untuk menjual kembali tanpa perjanjian agen, mengambil data dari aplikasi secara otomatis, mencoba mengakses akun atau bagian sistem yang bukan milikmu, atau memperlakukan kurir dan staf depot dengan kasar. Kami dapat membatasi atau menutup akun yang melakukannya.',
    },
    {
      heading: '13. Ketersediaan layanan',
      body: 'Kami berusaha menjaga layanan tetap berjalan, tetapi tidak menjanjikan bebas gangguan. Pemeliharaan, gangguan jaringan, dan hal di luar kendali kami dapat membuat layanan tidak tersedia sementara. Depot juga punya jam operasional dan wilayah layanan masing-masing, dan bisa berhenti melayani suatu wilayah.',
    },
    {
      heading: '14. Tanggung jawab kami',
      body: 'Kami bertanggung jawab atas kerugian yang timbul karena kesalahan kami sendiri. Untuk hal yang menjadi tanggung jawab depot — mutu air, keadaan galon, ketepatan pengantaran — kami membantu menyelesaikannya dan menghubungkanmu dengan depot yang bersangkutan. Ketentuan ini tidak mengurangi hak-hakmu sebagai konsumen berdasarkan UU No. 8 Tahun 1999 tentang Perlindungan Konsumen, dan bagian mana pun yang bertentangan dengan hak tersebut tidak berlaku sepanjang pertentangan itu.',
    },
    {
      heading: '15. Data pribadi',
      body: 'Cara kami mengumpulkan, memakai, menyimpan, dan menghapus data pribadimu dijelaskan di Kebijakan Privasi, termasuk hak-hakmu berdasarkan UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi. Kebijakan itu bagian dari ketentuan ini.',
    },
    {
      heading: '16. Perubahan ketentuan',
      body: 'Kami dapat memperbarui ketentuan ini. Bila perubahannya material, kami memberitahumu lewat aplikasi sebelum berlaku, dan tanggal "berlaku sejak" di atas selalu menunjukkan versi yang sedang berlaku. Bila kamu tidak setuju dengan versi baru, kamu dapat berhenti memakai layanan dan menghapus akunmu.',
    },
    {
      heading: '17. Hukum yang berlaku dan penyelesaian sengketa',
      body: 'Ketentuan ini tunduk pada hukum Republik Indonesia. Bila ada perselisihan, hubungi kami lebih dulu — sebagian besar selesai di tahap itu. Bila tidak, penyelesaiannya dapat ditempuh melalui musyawarah, Badan Penyelesaian Sengketa Konsumen (BPSK), atau pengadilan yang berwenang, sesuai pilihanmu berdasarkan peraturan perundang-undangan yang berlaku.',
    },
    {
      heading: '18. Menghubungi kami',
      body: 'Pertanyaan tentang ketentuan ini, keluhan, atau permintaan terkait akunmu dapat disampaikan lewat menu Bantuan di aplikasi.',
    },
  ],
};
