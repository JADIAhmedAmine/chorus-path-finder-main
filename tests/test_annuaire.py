from __future__ import annotations

import base64
import io
import json
import sys
import unittest
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.annuaire import (  # noqa: E402
    build_annuaire_files_from_api_response,
    decode_chorus_annuaire_file,
    parse_chorus_annuaire_xml,
)


ANNUAIRE_XML = b"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<CPPStructuresPartenaires>
  <CPPStructurePartenaireUnitaire>
    <TypeIdentifiant>SIRET</TypeIdentifiant>
    <Identifiant>23440003400026</Identifiant>
    <RaisonSociale>REGION DES PAYS DE LA LOIRE - SI EPLE</RaisonSociale>
    <Services>
      <Service>
        <Code>FACTURES_PUBLIQUES</Code>
        <Nom>Service des factures publiques</Nom>
        <ServiceActif>true</ServiceActif>
      </Service>
      <Service>
        <Code>SE_COMPTA</Code>
        <Nom>Comptabilite fournisseurs</Nom>
        <ServiceActif>true</ServiceActif>
      </Service>
    </Services>
    <GestionEngagement>true</GestionEngagement>
    <GestionService>true</GestionService>
    <StructureActive>true</StructureActive>
  </CPPStructurePartenaireUnitaire>
</CPPStructuresPartenaires>
"""


class AnnuaireTest(unittest.TestCase):
    maxDiff = None

    def test_parse_chorus_annuaire_xml_maps_customers_and_services(self) -> None:
        catalog = parse_chorus_annuaire_xml(ANNUAIRE_XML)

        self.assertEqual(catalog.structure_count, 1)
        self.assertEqual(catalog.service_count, 2)
        self.assertEqual(
            catalog.public_customers[0],
            {
                "id": "annuaire-23440003400026",
                "tenantId": "chorus-annuaire",
                "codeDestinataire": "23440003400026",
                "legalName": "REGION DES PAYS DE LA LOIRE - SI EPLE",
                "siret": "23440003400026",
                "structureType": "SERVICE",
                "active": True,
                "createdAt": "1970-01-01T00:00:00.000Z",
                "updatedAt": "1970-01-01T00:00:00.000Z",
            },
        )
        self.assertEqual(catalog.public_services[1]["codeServiceExecutant"], "SE_COMPTA")
        self.assertEqual(catalog.public_services[1]["label"], "Comptabilite fournisseurs")
        self.assertTrue(catalog.public_services[1]["engagementRequired"])

    def test_decode_chorus_annuaire_file_accepts_zip_base64(self) -> None:
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as archive:
            archive.writestr("FAR0037A_SEC001_CPP001.xml", ANNUAIRE_XML)

        decoded = decode_chorus_annuaire_file(base64.b64encode(zip_buffer.getvalue()).decode("ascii"))

        self.assertEqual(decoded.source_file, "FAR0037A_SEC001_CPP001.xml")
        self.assertIn(b"CPPStructuresPartenaires", decoded.content)

    def test_build_annuaire_files_from_api_response_writes_xml_and_normalized_json(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            json_path = output_dir / "annuaire.normalized.json"
            xml_path = output_dir / "annuaire.xml"

            result = build_annuaire_files_from_api_response(
                {
                    "codeRetour": 0,
                    "fichierResultat": base64.b64encode(ANNUAIRE_XML).decode("ascii"),
                    "libelle": "TRA_MSG_00.000",
                },
                json_output_path=json_path,
                xml_output_path=xml_path,
            )

            payload = json.loads(json_path.read_text(encoding="utf-8"))

        self.assertEqual(result.json_path, json_path)
        self.assertEqual(result.xml_path, xml_path)
        self.assertEqual(payload["metadata"]["structureCount"], 1)
        self.assertEqual(payload["metadata"]["serviceCount"], 2)
        self.assertEqual(payload["publicCustomers"][0]["codeDestinataire"], "23440003400026")
        self.assertEqual(payload["publicServices"][0]["publicCustomerId"], "annuaire-23440003400026")


if __name__ == "__main__":
    unittest.main()
