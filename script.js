// --- FUNGSI EKSPOR/IMPOR FILE ---
        
        // Mengunduh data sebagai file .json
        function eksporKeFile() {
            // Ubah data mindmap kita menjadi string JSON dengan format yang rapi
            const dataString = JSON.stringify(mindmapData, null, 2); 
            
            // Buat 'blob' (objek data mentah) dari string tersebut
            const blob = new Blob([dataString], { type: "application/json" });
            
            // Buat link imajiner untuk memicu download
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = "mindmap_kamu.json"; // Nama file default
            document.body.appendChild(a);
            a.click(); // Klik imajiner untuk mendownload
            document.body.removeChild(a); // Hapus link setelah selesai
            URL.revokeObjectURL(url);
        }

        // Membaca file .json yang dipilih pengguna
        function imporDariFile(event) {
            const file = event.target.files[0];
            if (!file) return; // Jika batal memilih file

            const reader = new FileReader(); // Objek pembaca file
            
            reader.onload = function(e) {
                try {
                    // Coba baca dan ubah isi file kembali menjadi array
                    const dataBaru = JSON.parse(e.target.result);
                    
                    if (Array.isArray(dataBaru)) {
                        // Jika berhasil dan formatnya array, timpa data kita
                        mindmapData = dataBaru;
                        simpanDataOtomatis(); // Update juga localStorage
                        renderSemua(); // Gambar ulang di layar
                        alert("Data berhasil dimuat!");
                    } else {
                        alert("Format file tidak valid!");
                    }
                } catch (error) {
                    alert("Terjadi kesalahan saat membaca file JSON.");
                }
            };
            
            reader.readAsText(file); // Mulai membaca file sebagai teks
            
            // Reset input file agar bisa memilih file yang sama lagi jika perlu
            event.target.value = ''; 
        }
